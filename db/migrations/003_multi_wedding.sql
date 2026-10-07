-- One server, many weddings: each album gets an unguessable public id for its
-- guest URL (/w/<public_id>) plus its own names, date, optional password and
-- cover. Guests belong to one album and no longer need a phone number.
-- Safe to run on a live database.

ALTER TABLE shared_albums
    ADD COLUMN IF NOT EXISTS public_id           varchar(16),
    ADD COLUMN IF NOT EXISTS event_date          varchar(32),
    ADD COLUMN IF NOT EXISTS guest_password_hash varchar(100),
    ADD COLUMN IF NOT EXISTS cover_key           varchar(512);
UPDATE shared_albums
   SET public_id = substr(lower(translate(encode(gen_random_bytes(12), 'base64'), '+/=', '')), 1, 10)
 WHERE public_id IS NULL;
ALTER TABLE shared_albums ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_albums_public_id ON shared_albums (public_id);

ALTER TABLE guests
    ADD COLUMN IF NOT EXISTS album_id uuid REFERENCES shared_albums (id) ON DELETE CASCADE,
    ALTER COLUMN name DROP NOT NULL;
UPDATE guests
   SET album_id = (SELECT id FROM shared_albums ORDER BY created_at LIMIT 1)
 WHERE album_id IS NULL;
ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_phone_key;
CREATE INDEX IF NOT EXISTS idx_guests_album_id ON guests (album_id);
