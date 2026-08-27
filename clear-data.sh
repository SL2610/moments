#!/usr/bin/env bash
# Wipes guest-facing test data from the running docker compose stack, so you
# can re-test the whole flow (join, upload, tag, search) from a clean slate.
#
# Default: guests, tags, photos, embeddings, processing jobs, and the files
# under ./data/photos. Keeps your admin login and the wedding album record,
# so the app keeps working right after.
#
# --full: also wipes the admin user and the album record. You'll need to
# re-register and recreate the album afterwards.
set -euo pipefail
cd "$(dirname "$0")"

tables="photo_tags, photo_embeddings, processing_jobs, photos, guests"
if [ "${1:-}" = "--full" ]; then
	tables="$tables, shared_albums, users"
fi

docker compose exec -T postgres sh -c \
	"psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c 'TRUNCATE TABLE $tables CASCADE;'"

docker compose exec -T api sh -c 'rm -rf /data/photos/*'

echo "Cleared: $tables (+ files in ./data/photos)."
