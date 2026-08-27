# Self-Hosting Moments

Everything runs on one machine through Docker Compose. No cloud accounts required.

Not comfortable with a terminal at all? See [AI_SETUP.md](AI_SETUP.md) — a
prompt you hand to an AI assistant that does this for you.

## Quick start

```bash
git clone https://github.com/SL2610/moments
cd moments
./setup.sh
```

`setup.sh` asks for your names, wedding date, guest password, and admin
login, generates the random secrets, writes `.env`, and starts everything.
(Prefer to do it by hand? `cp .env.example .env`, fill in the `CHANGE ME`
lines — `openssl rand -base64 48` for `JWT_SECRET`/`VIEW_URL_SECRET` — then
`docker compose up -d`.)

Then:

1. Once you've created your own admin account (`setup.sh` does this, or open
   http://localhost:2610/signup by hand), set `ALLOW_REGISTRATION=false` in
   `.env` and `docker compose up -d api` to stop anyone else from signing up.
2. Add photos: bulk import (below) or the admin upload page.
3. Guests open http://localhost:2610 (or your public URL), enter their phone
   number, full name, and `GUEST_PASSWORD`, and get the shared gallery.
4. Guests outside your own Wi-Fi need a public URL — see **Hosting options**
   below.

## The guest experience (Hebrew + English)

The landing page opens with a thank-you note, an optional hero photo, a short
how-to, and the join form. Guests can switch language (Hebrew is the
default) with the toggle on the page. Put your own photo at
`./data/branding/hero.jpg` on the host to replace the default, and an
invitation graphic at `./data/branding/invite-card.png` if you have one
(both served live, no rebuild — skipped cleanly if you don't provide them).

The root page is the wedding app: guests join with their phone number, full
name, and the shared password (the phone number is the stable identity; the
name is locked on first join), browse the full photo pool, upload their own
photos into it, find themselves with a selfie, and confirm it's them to
self-tag. There's no tagging other guests by name. A person view has a
download-all ZIP. The admin area (`/login`, `/dashboard`, English-only for
now) keeps album management, folder import, privacy, and processing status.

The wedding album is the oldest album in the database, auto-created for the
first admin account. Imported and guest-uploaded photos are PUBLIC (visible
to every logged-in guest); photos an admin marks PROTECTED only surface
through a face match.

## Hosting options — getting a public URL

Everything above works on `localhost`. To let guests who aren't on your home
Wi-Fi in, you need a public address pointed at your machine. Two realistic
$0 options:

**1. Your own computer + Cloudflare Tunnel (recommended).** Keep a computer
on and connected to the internet; Cloudflare Tunnel exposes it publicly
without opening any router ports. Two modes:

- **Quick tunnel** — zero setup: `cloudflared tunnel --url http://localhost:2610`
  gives you a random `trycloudflare.com` URL immediately. It's genuinely
  free, but the address **changes every time the tunnel restarts** — fine
  for testing, risky for sharing on invitations.
- **Named tunnel** — a stable address that doesn't change. Requires you to
  already own (or buy, ~$10–15/yr) a domain on Cloudflare. Set up:
  1. Cloudflare Zero Trust → Networks → Tunnels → create a tunnel, copy the
     token into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.
  2. Add a public hostname (e.g. `photos.yourdomain.com`) → service
     `http://web:3000`.
  3. `docker compose --profile tunnel up -d`

  Only the web app is ever exposed; every other service stays on the private
  Docker network either way.

**2. Oracle Cloud "Always Free" tier — no home computer needed.** Oracle
gives away an ARM VM (up to 24 GB RAM / 4 OCPU) forever, free, no card
charged. Good if you don't want to leave a computer running at home. Caveat:
it's ARM64, and this stack's AI images (TensorFlow/PyTorch-based) are
**not verified on ARM** — build the `ai-worker`/`ai-search` images on the VM
first (`docker compose build ai-worker ai-search`) and confirm they start
before committing to this path. If they don't build cleanly, fall back to
option 1 or a small paid x86 VM.

## Services

| Service | Image / build | Exposed |
|---|---|---|
| web | `web/` (Next.js standalone) | 127.0.0.1:2610 only (`WEB_PORT`) |
| api | `api/` (Spring Boot) | internal |
| ai-search | `ai-face-worker/` (`api.py`, FastAPI) | internal |
| ai-worker | `ai-face-worker/` (`main.py`, queue worker) | internal |
| postgres | `pgvector/pgvector:pg16` | internal |
| redis | `redis:7-alpine` (rate limiting) | internal |
| cloudflared | `cloudflare/cloudflared` | optional, profile `tunnel` |

Persistent state: `pgdata` volume (database), `./data/photos` bind mount
(originals + previews + thumbnails), `ai-models` volume (face-recognition
model weights, downloaded once on first run).

## Bulk photo import (recommended for thousands of photos)

1. Copy the photographer's files to `./data/import/` on the host (subfolders fine).
2. In the app: album → Add Photos → **Import Local Folder** → path `/import` → Import Folder.
3. Progress (found / imported / duplicates / failed) shows live. Duplicates are detected by file hash, so re-running the import only retries failures.

Face indexing runs in the background; the album view shows per-photo scanning status. "Backfill" re-queues anything unprocessed.

## GPU vs CPU

CPU is the default and needs nothing special. First indexing of thousands of photos takes a while (roughly 1–3 s/photo on a modern CPU); index before the wedding.

NVIDIA GPU (needs the NVIDIA Container Toolkit):

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml build ai-worker ai-search
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

Raise `AI_WORKER_CONCURRENCY` in `.env` (e.g. 4) when on GPU.

## Configuration notes

- `PHOTO_MAX_SIZE_MB`, `TURNSTILE_SITE_KEY`, `DEMO_SELFIE_UPLOAD`, `EVENT_NAME`, `EVENT_DATE` are baked into the web image at build time: run `docker compose build web` after changing them.
- Turnstile bot protection is off when `TURNSTILE_SECRET`/`TURNSTILE_SITE_KEY` are blank.
- Photo processing jobs live in the `processing_jobs` table (PENDING → PROCESSING → COMPLETED/FAILED, `JOB_MAX_ATTEMPTS` retries, crashed jobs are reclaimed after 15 minutes).
- Photos are served through short-lived HMAC-signed URLs; protected originals are never enumerable by URL.

## Operations

```bash
docker compose logs -f ai-worker      # watch indexing
docker compose ps                     # health
docker compose restart                # safe: photos, DB, models, and job state persist
docker compose exec postgres psql -U grabpic grabpic \
  -c "SELECT status, count(*) FROM processing_jobs GROUP BY 1;"
./clear-data.sh                       # reset guests/tags/photos for retesting (--full also wipes admin+album)
```

Backup = `pg_dump` (or the `pgdata` volume) + `./data/photos`.
