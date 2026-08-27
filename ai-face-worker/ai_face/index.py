"""Exact in-memory per-album face index.

Event-sized data (10k-30k faces x 512 float32 ~ tens of MB) is searched with
a plain normalized matrix product; PostgreSQL stays the persistence layer.
Only embeddings produced by the CURRENT recognizer version are loaded; if an
album has processed photos but no current-version embeddings, the album needs
a reindex and search must say so loudly instead of returning empty results.
"""

import threading
import time

import numpy as np

from . import config, db


class ReindexRequiredError(Exception):
    pass


class AlbumFaceIndex:
    def __init__(self, album_id: str):
        self.album_id = album_id
        self.embeddings = np.zeros((0, 512), dtype=np.float32)
        self.face_ids: list[str] = []
        self.photo_ids: list[str] = []
        self.qualities = np.zeros(0, dtype=np.float32)
        self.version_key: tuple = ()
        self.model_version = config.RECOGNIZER_VERSION

    def load(self) -> None:
        with db.connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT pe.id, pe.photo_id, pe.embedding::text, COALESCE(pe.quality_score, 0.5)
                FROM photo_embeddings pe
                JOIN photos p ON p.id = pe.photo_id
                WHERE p.album_id = %s AND pe.recognizer_version = %s
                ORDER BY pe.id
                """,
                (self.album_id, config.RECOGNIZER_VERSION),
            )
            rows = cur.fetchall()
            cur.close()

        if not rows:
            # Distinguish "album has no faces yet" from "album was indexed by
            # an incompatible pipeline and must be reindexed".
            with db.connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT count(*) FROM photo_embeddings pe
                    JOIN photos p ON p.id = pe.photo_id
                    WHERE p.album_id = %s
                      AND (pe.recognizer_version IS NULL OR pe.recognizer_version <> %s)
                    """,
                    (self.album_id, config.RECOGNIZER_VERSION),
                )
                stale = cur.fetchone()[0]
                cur.close()
            if stale > 0:
                raise ReindexRequiredError(
                    f"album {self.album_id}: {stale} embeddings from an incompatible "
                    f"pipeline version; run a reindex (expected {config.RECOGNIZER_VERSION})"
                )

        self.face_ids = [str(r[0]) for r in rows]
        self.photo_ids = [str(r[1]) for r in rows]
        self.qualities = np.asarray([r[3] for r in rows], dtype=np.float32)
        self.embeddings = (
            np.stack([db.parse_vector(r[2]) for r in rows])
            if rows else np.zeros((0, 512), dtype=np.float32)
        )
        self.version_key = self._current_version_key()

    def _current_version_key(self) -> tuple:
        with db.connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT count(*), COALESCE(max(pe.created_at)::text, '')
                FROM photo_embeddings pe
                JOIN photos p ON p.id = pe.photo_id
                WHERE p.album_id = %s AND pe.recognizer_version = %s
                """,
                (self.album_id, config.RECOGNIZER_VERSION),
            )
            row = cur.fetchone()
            cur.close()
        return (row[0], row[1])

    def is_stale(self) -> bool:
        return self._current_version_key() != self.version_key

    def similarities(self, query: np.ndarray) -> np.ndarray:
        """Cosine similarity of one normalized query against all faces."""
        if len(self.face_ids) == 0:
            return np.zeros(0, dtype=np.float32)
        return self.embeddings @ np.asarray(query, dtype=np.float32)


class IndexCache:
    """Per-album cache with staleness revalidation."""

    def __init__(self, revalidate_secs: float = 20.0):
        self._indexes: dict[str, AlbumFaceIndex] = {}
        self._checked_at: dict[str, float] = {}
        self._lock = threading.Lock()
        self._revalidate_secs = revalidate_secs

    def get(self, album_id: str) -> AlbumFaceIndex:
        with self._lock:
            index = self._indexes.get(album_id)
            now = time.monotonic()
            needs_check = index is None or (now - self._checked_at.get(album_id, 0)) > self._revalidate_secs
            if index is not None and not needs_check:
                return index
        # Load/refresh outside the lock (DB roundtrip).
        if index is None or index.is_stale():
            fresh = AlbumFaceIndex(album_id)
            fresh.load()
            index = fresh
        with self._lock:
            self._indexes[album_id] = index
            self._checked_at[album_id] = time.monotonic()
        return index

    def invalidate(self, album_id: str | None = None) -> None:
        with self._lock:
            if album_id is None:
                self._indexes.clear()
                self._checked_at.clear()
            else:
                self._indexes.pop(album_id, None)
                self._checked_at.pop(album_id, None)


index_cache = IndexCache()
