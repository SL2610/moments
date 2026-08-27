# Hosting runbook (internal — not couple-facing)

Checklist for fulfilling a paid "hosted for you" order. This is concierge,
not a platform: one manual Docker Compose deployment per paying couple, on a
VM you control. No new code — this just chains together `setup.sh` and the
Cloudflare Tunnel flow already documented in `SELF_HOSTING.md`.

## Per-order checklist

1. **Get the details.** Couple's names (as guests should see them), wedding
   date, a guest password, and a subdomain you'll give them (e.g.
   `dana-yossi.<your-domain>`).
2. **Provision a VM**, one of:
   - Reuse a single beefy always-on box and run multiple `docker compose`
     stacks on it (different `WEB_PORT` per couple, one directory per order).
   - A fresh Oracle Free Tier ARM VM per couple (see caveat on ARM in
     `SELF_HOSTING.md` — verify the AI images build before relying on it).
   - A small paid x86 VM if ARM doesn't work out or you want isolation.
3. **Deploy:**
   ```bash
   git clone https://github.com/sagi5060/moments dana-yossi
   cd dana-yossi
   ./setup.sh --event-name "Dana & Yossi" --event-date 12.06.2027 \
     --guest-password <chosen> --admin-email <couple's email> \
     --admin-password <generate one, send separately> \
     --public-url https://dana-yossi.<your-domain>
   ```
4. **DNS + tunnel:** point `dana-yossi.<your-domain>` at that VM's tunnel —
   named Cloudflare Tunnel, per `SELF_HOSTING.md`'s Hosting Options section.
5. **Verify:** open the guest URL yourself, confirm the join flow works.
6. **Hand off:** send the couple their guest link + password, and their
   admin email (they set their own password during checkout, or you send a
   one-time reset).

## Ongoing

- Each couple's data lives entirely in their own `./data/` + Postgres volume
  — no shared database, no cross-couple access possible.
- Decommission after the event (or per your retention policy): `docker
  compose down -v` in that couple's directory, then delete the directory.
- If this starts taking real time, the next step up is automating steps 2–4
  (a small provisioning script) before considering full multi-tenancy — see
  the "out of scope" note in the original planning doc for why that's not
  built yet.
