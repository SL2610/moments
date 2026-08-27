-- GrabPic self-hosted schema. Runs once on first startup of the postgres container.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         varchar(255) NOT NULL UNIQUE,
    password_hash varchar(100) NOT NULL,
    created_at    timestamp NOT NULL DEFAULT now()
);

CREATE TABLE shared_albums (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title      varchar(255) NOT NULL,
    host_id    varchar(255) NOT NULL,
    created_at timestamp
);
CREATE INDEX idx_shared_albums_host_id ON shared_albums (host_id);

CREATE TABLE photos (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id     uuid NOT NULL REFERENCES shared_albums (id) ON DELETE CASCADE,
    storage_url  varchar(255) NOT NULL,
    access_mode  varchar(16) NOT NULL,
    processed    boolean NOT NULL DEFAULT false,
    content_hash varchar(64),
    uploaded_by  uuid,
    created_at   timestamp,
    -- face pipeline v2: PENDING | PROCESSING | READY | NO_FACES | FAILED
    processing_state    varchar(16) NOT NULL DEFAULT 'PENDING',
    processing_error    text,
    face_count          integer,
    processed_at        timestamp,
    processing_attempts integer NOT NULL DEFAULT 0,
    detector_version    varchar(64),
    recognizer_version  varchar(64)
);
CREATE INDEX idx_photos_processing_state ON photos (processing_state);
CREATE INDEX idx_photos_album_id ON photos (album_id);
CREATE INDEX idx_photos_album_hash ON photos (album_id, content_hash);

-- Wedding guests: lightweight name-based identities (no passwords; entry is
-- gated by the shared GUEST_PASSWORD).
CREATE TABLE guests (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       varchar(80) NOT NULL,
    phone      varchar(32) UNIQUE,
    created_at timestamp
);
CREATE INDEX idx_guests_name_lower ON guests (lower(name));

-- "This is me" / "that's them" name tags on photos.
CREATE TABLE photo_tags (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id   uuid NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
    guest_id   uuid NOT NULL REFERENCES guests (id) ON DELETE CASCADE,
    tagged_by  uuid,
    created_at timestamp,
    UNIQUE (photo_id, guest_id)
);
CREATE INDEX idx_photo_tags_guest ON photo_tags (guest_id);

CREATE TABLE photo_embeddings (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id  uuid NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
    embedding vector(512),
    box_area  jsonb,
    -- face pipeline v2 metadata
    detector_confidence real,
    face_width          integer,
    face_height         integer,
    quality_score       real,
    detector_version    varchar(64),
    recognizer_version  varchar(64),
    created_at          timestamp DEFAULT now()
);
CREATE INDEX idx_photo_embeddings_recognizer ON photo_embeddings (recognizer_version);
CREATE INDEX idx_photo_embeddings_photo_id ON photo_embeddings (photo_id);
CREATE INDEX idx_photo_embeddings_hnsw ON photo_embeddings
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Job queue replacing AWS SQS. Status: PENDING | PROCESSING | COMPLETED | FAILED.
CREATE TABLE processing_jobs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id    uuid NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
    storage_key varchar(255) NOT NULL,
    status      varchar(16) NOT NULL DEFAULT 'PENDING',
    attempts    integer NOT NULL DEFAULT 0,
    last_error  text,
    created_at  timestamp NOT NULL DEFAULT now(),
    updated_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX idx_processing_jobs_status ON processing_jobs (status, created_at);
