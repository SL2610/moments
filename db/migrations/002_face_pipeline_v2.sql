-- Face pipeline v2: explicit processing states + embedding metadata/versions.
-- Safe to run on a live database (additive; legacy embeddings are kept until reindex).

ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS processing_state    varchar(16) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS processing_error    text,
    ADD COLUMN IF NOT EXISTS face_count          integer,
    ADD COLUMN IF NOT EXISTS processed_at        timestamp,
    ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS detector_version    varchar(64),
    ADD COLUMN IF NOT EXISTS recognizer_version  varchar(64);

-- Legacy rows: reflect the old boolean until the v2 reindex overwrites them.
UPDATE photos SET processing_state = CASE WHEN processed THEN 'READY' ELSE 'PENDING' END
WHERE processing_state = 'PENDING' AND processed;

ALTER TABLE photo_embeddings
    ADD COLUMN IF NOT EXISTS detector_confidence real,
    ADD COLUMN IF NOT EXISTS face_width          integer,
    ADD COLUMN IF NOT EXISTS face_height         integer,
    ADD COLUMN IF NOT EXISTS quality_score       real,
    ADD COLUMN IF NOT EXISTS detector_version    varchar(64),
    ADD COLUMN IF NOT EXISTS recognizer_version  varchar(64),
    ADD COLUMN IF NOT EXISTS created_at          timestamp DEFAULT now();

-- Rows with NULL recognizer_version are legacy GhostFaceNet embeddings; the v2
-- search loads only current-version rows and reports "reindex required".
CREATE INDEX IF NOT EXISTS idx_photo_embeddings_recognizer
    ON photo_embeddings (recognizer_version);

CREATE INDEX IF NOT EXISTS idx_photos_processing_state
    ON photos (processing_state);
