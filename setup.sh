#!/usr/bin/env bash
# One-command setup: asks a few questions (or reads flags/env vars for
# non-interactive/scripted use), writes .env with generated secrets, and
# brings the stack up with docker compose.
#
# Interactive:      ./setup.sh
# Non-interactive:  ./setup.sh --event-name "Dana & Yossi" --event-date 12.06.2027 \
#                     --guest-password sunflower22 --admin-email dana@example.com \
#                     --admin-password s0mething-strong
# Flags not given fall back to prompts (interactive) or generated/blank
# defaults (non-interactive, when stdin isn't a TTY).
set -euo pipefail
cd "$(dirname "$0")"

EVENT_NAME=""
EVENT_DATE=""
GUEST_PASSWORD=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
PUBLIC_URL=""
SKIP_UP=""

while [ $# -gt 0 ]; do
	case "$1" in
	--event-name) EVENT_NAME="$2"; shift 2 ;;
	--event-date) EVENT_DATE="$2"; shift 2 ;;
	--guest-password) GUEST_PASSWORD="$2"; shift 2 ;;
	--admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
	--admin-password) ADMIN_PASSWORD="$2"; shift 2 ;;
	--public-url) PUBLIC_URL="$2"; shift 2 ;;
	--no-up) SKIP_UP=1; shift ;;
	*) echo "Unknown flag: $1" >&2; exit 1 ;;
	esac
done

command -v docker >/dev/null || { echo "Docker is required. Install it first: https://docs.docker.com/get-docker/" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required (usually preinstalled on macOS/Linux)." >&2; exit 1; }

if [ -f .env ]; then
	echo ".env already exists. Delete it first if you want to start over. Exiting without changes."
	exit 1
fi

is_tty() { [ -t 0 ]; }

ask() {
	# ask <prompt> <default> -> prints the answer
	local prompt="$1" default="$2" answer
	if [ -n "$default" ] || ! is_tty; then
		echo "$default"
		return
	fi
	read -r -p "$prompt: " answer
	echo "$answer"
}

EVENT_NAME=$(ask "Couple's names, as guests should see them (e.g. Dana & Yossi)" "$EVENT_NAME")
EVENT_DATE=$(ask "Wedding date (e.g. 12.06.2027)" "$EVENT_DATE")
GUEST_PASSWORD=$(ask "Shared guest password (guests type this, with their phone + name, to get in)" "$GUEST_PASSWORD")
ADMIN_EMAIL=$(ask "Your (the couple's) admin login email" "$ADMIN_EMAIL")
ADMIN_PASSWORD=$(ask "Your admin login password" "$ADMIN_PASSWORD")
PUBLIC_URL=$(ask "Public URL guests will use, if you already know it (blank is fine, edit .env later)" "$PUBLIC_URL")

[ -n "$EVENT_NAME" ] || EVENT_NAME="Your Names Here"
[ -n "$EVENT_DATE" ] || EVENT_DATE="DD.MM.YYYY"
[ -n "$GUEST_PASSWORD" ] || GUEST_PASSWORD="$(openssl rand -hex 4)"
[ -n "$PUBLIC_URL" ] || PUBLIC_URL="https://your-domain.example.com"

JWT_SECRET="$(openssl rand -base64 48)"
VIEW_URL_SECRET="$(openssl rand -base64 48)"
POSTGRES_PASSWORD="$(openssl rand -base64 24)"

# Plain bash line rewriting (not sed) because couple names routinely contain
# "&" (e.g. "Dana & Yossi"), which sed's replacement syntax treats specially.
: > .env
while IFS= read -r line || [ -n "$line" ]; do
	case "$line" in
	EVENT_NAME=*) line="EVENT_NAME=${EVENT_NAME}" ;;
	EVENT_DATE=*) line="EVENT_DATE=${EVENT_DATE}" ;;
	GUEST_PASSWORD=*) line="GUEST_PASSWORD=${GUEST_PASSWORD}" ;;
	PUBLIC_URL=*) line="PUBLIC_URL=${PUBLIC_URL}" ;;
	CORS_ALLOWED_ORIGINS=*) line="CORS_ALLOWED_ORIGINS=${PUBLIC_URL},http://localhost:2610" ;;
	TURNSTILE_ALLOWED_HOSTNAMES=*) line="TURNSTILE_ALLOWED_HOSTNAMES=localhost" ;;
	POSTGRES_PASSWORD=*) line="POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" ;;
	JWT_SECRET=*) line="JWT_SECRET=${JWT_SECRET}" ;;
	VIEW_URL_SECRET=*) line="VIEW_URL_SECRET=${VIEW_URL_SECRET}" ;;
	ADMIN_EMAIL=*) line="ADMIN_EMAIL=${ADMIN_EMAIL}" ;;
	ADMIN_PASSWORD=*) line="ADMIN_PASSWORD=${ADMIN_PASSWORD}" ;;
	esac
	printf '%s\n' "$line" >> .env
done < .env.example

echo "Wrote .env."

if [ -n "$SKIP_UP" ]; then
	echo "Skipping docker compose (--no-up). Run 'docker compose build && docker compose up -d' when ready."
	exit 0
fi

echo "Building and starting (this downloads the AI models on first run, can take a few minutes)..."
docker compose build
docker compose up -d

cat <<EOF

Done. The app is starting at http://localhost:2610

Guest password: ${GUEST_PASSWORD}
Admin login:    ${ADMIN_EMAIL}

To share it outside your own network, see SELF_HOSTING.md for the Cloudflare
Tunnel step (needed before guests who aren't on your Wi-Fi can reach it).
EOF
