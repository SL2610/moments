# Set this up with an AI assistant instead of a terminal

If you're not a developer, this is the easiest way to get your gallery
online: you don't type any commands yourself. You hand the box below to an
AI assistant that can actually run commands on a computer, and it does the
setup for you, then tells you your gallery link and password.

**This needs an AI tool with real terminal access to the computer that will
run the gallery.** [Claude Code](https://claude.com/product/claude-code) is
the one we've tested this with. A plain chat window (ChatGPT, Claude on the
web, etc.) can't do this: it has no way to actually run commands on your
computer, so it can talk you through the steps but can't do them for you.

If you don't have Claude Code and don't want to install it, use the manual
steps in the main [README](README.md) / [SELF_HOSTING.md](SELF_HOSTING.md)
instead, or see the "hosted for you" option in the README if you'd rather
pay someone else to do this entirely.

## What to do

1. Install [Claude Code](https://claude.com/product/claude-code) on the
   computer you want to run your gallery on (your own laptop/desktop that
   you can leave on, or a free cloud server; the assistant will explain the
   cloud option if you ask it to).
2. Open a terminal, run `claude`, and paste the entire box below as your
   first message.
3. Answer the couple of plain-language questions it asks you.
4. Wait. It'll tell you when your gallery link and password are ready.

## The prompt

```
You are setting up a self-hosted wedding photo gallery ("Moments") for a
couple who are not developers. Be patient, plain-spoken, and do the work
yourself rather than asking them to run commands. Confirm before anything
that costs money or is hard to undo (buying a domain, creating a paid cloud
server). Everything below is free unless noted.

1. Check whether Docker is installed and running (`docker info`). If not,
   walk the couple through installing Docker Desktop (docs.docker.com/get-docker)
   for their OS, waiting for them to confirm it's installed, before continuing.

2. Ask the couple, one question at a time, in plain language (no jargon):
   - Their names, the way they want guests to see them (e.g. "Dana & Yossi").
   - Their wedding date.
   - A guest password guests will type to get in (offer to generate a simple
     memorable one if they don't want to pick one, it goes on their invite/QR
     code, so it should be easy to say out loud).
   - An email + password for their own admin login (to manage the gallery).
   - Whether this will run on the computer you're working on right now (they
     need to leave it powered on and connected to the internet), or on a
     cloud server. If they want a cloud server and don't have one, point them
     to the free Oracle Cloud "Always Free" tier (see SELF_HOSTING.md in the
     repo once cloned) and offer to SSH in and continue there once it's created.
     This is optional and more advanced; the couple's own computer is the
     simpler default.

3. Clone https://github.com/SL2610/moments into a sensible local directory
   (ask the couple, or default to their home directory).

4. Run `./setup.sh` inside the cloned repo, non-interactively, using their
   answers, e.g.:
     ./setup.sh --event-name "Dana & Yossi" --event-date 12.06.2027 \
       --guest-password sunflower22 --admin-email dana@example.com \
       --admin-password <their password>
   This builds and starts everything with Docker Compose. The first build
   downloads AI models and can take several minutes: say so, don't go quiet.

5. Confirm it's actually up: `curl -sf http://localhost:2610 >/dev/null` (or
   equivalent) before declaring success.

6. Set up a way for guests outside their home network to reach it. Default to
   the quick, zero-setup Cloudflare Tunnel mode (`cloudflared tunnel --url
   http://localhost:2610`, no account needed) and explain plainly that this
   free URL changes if the tunnel restarts: fine for testing, but before the
   wedding they should either keep that tunnel process running continuously,
   or (if they already own a domain, or are willing to buy one for ~$10-15/yr)
   set up a named Cloudflare Tunnel with a stable address. See
   SELF_HOSTING.md's Cloudflare Tunnel section for both options, and confirm
   with them before spending any money.

7. Once it's reachable, report back ONLY this, in plain language, no logs, no
   jargon, no command output:
   - Their gallery link (the one guests will actually use).
   - The guest password.
   - Their admin email (remind them they set their own password).
   - One line on how to keep it running (leave the computer on / keep the
     tunnel process running) and where to find more detail if something
     breaks later (SELF_HOSTING.md in the cloned repo).
```
