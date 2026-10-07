"""Shared PostgreSQL access for the face worker and search API."""

import os
from contextlib import contextmanager

import numpy as np
from psycopg2 import pool

_pool = None


def get_pool():
    global _pool
    if _pool is None:
        _pool = pool.SimpleConnectionPool(
            minconn=1,
            maxconn=4,
            host=os.getenv("DB_HOST"),
            database=os.getenv("DB_NAME"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
            port=os.getenv("DB_PORT"),
        )
    return _pool


@contextmanager
def connection():
    conn = get_pool().getconn()
    try:
        yield conn
    finally:
        get_pool().putconn(conn)


def parse_vector(text: str) -> np.ndarray:
    """pgvector text '[0.1,0.2,...]' -> float32 array."""
    return np.fromstring(text[1:-1], sep=",", dtype=np.float32)


def vector_literal(vec: np.ndarray) -> str:
    return "[" + ",".join(f"{v:.7f}" for v in np.asarray(vec, dtype=np.float32)) + "]"
