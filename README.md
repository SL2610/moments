# Moments

**A wedding photo gallery your guests find themselves in — no accounts, no
scrolling through hundreds of photos.** Upload the event photos, share one
link. Each guest takes a selfie and instantly sees every photo they're in.

Self-hosted, free, and open source. **Your photos and your guests' faces
never leave your own machine** — there's no cloud service in the loop unless
you choose to add one (e.g. Cloudflare Tunnel, just to expose the URL).

## Quick start

Not a developer? Two easier options first:

- **[AI_SETUP.md](AI_SETUP.md)** — hand a prompt to an AI assistant
  (Claude Code) and it sets everything up for you.
- **Hosted for you** — see below, we'll run it for you.

Comfortable with a terminal:

```bash
git clone https://github.com/SL2610/moments
cd moments
./setup.sh
```

That's it — `setup.sh` asks a few questions (your names, wedding date, guest
password) and brings the whole thing up with Docker. Full details, hosting
options, and bulk photo import: **[SELF_HOSTING.md](SELF_HOSTING.md)**.

## Hosted for you

Don't want to run anything yourself? We'll deploy and manage your gallery on
our infrastructure — you just send us your details and get a link back.

> **TODO (repo owner):** replace this with your actual pricing + a Stripe
> Payment Link or contact email. (Order fulfillment runbook lives in the
> private `SL2610/moments-admin` repo.)

## How it works

1. **Upload.** Add your event photos through the admin dashboard, or bulk-import
   thousands of files from a folder.
2. **AI scans every face.** A background worker detects faces and stores a
   fingerprint for each one — nothing leaves your machine.
3. **Guests find themselves.** Share one link. A guest opens it, joins with
   their phone number and the shared password, and can browse everything,
   add their own photos, or hit "find my photos" to selfie-search and
   download just the ones they're in.

Guests get Hebrew (default) or English, with a language toggle right on the
page.

## Stack

Next.js + React frontend, Spring Boot API, a Python face-recognition worker
(SCRFD detection + AdaFace embeddings) over Postgres/pgvector, all wired
together with Docker Compose. No AWS, no Supabase, no Vercel required — see
[SELF_HOSTING.md](SELF_HOSTING.md) for the full picture and
[FACE_ENGINE.md](FACE_ENGINE.md) for how the AI side works.

## License

MIT — see [LICENSE](LICENSE). Built on the architecture of
[Shahir-47/grab-pic](https://github.com/Shahir-47/grab-pic).

---

<div dir="rtl">

## בעברית: התחלה מהירה

גלריית תמונות לחתונה שבה כל אורח מוצא את עצמו לבד, עם סלפי, בלי לגלול באלפי
תמונות. מתארחת על המחשב שלכם, בחינם, בקוד פתוח — התמונות והפרצופים לא
עוזבים את המכשיר שלכם.

לא מפתחים? ראו [AI_SETUP.md](AI_SETUP.md) — מעבירים פרומפט לעוזר AI והוא
עושה את ההתקנה בשבילכם. או שנטפל בזה בעצמנו — ראו "Hosted for you" למעלה.

נוח לכם עם טרמינל:

```bash
git clone https://github.com/SL2610/moments
cd moments
./setup.sh
```

הסקריפט שואל כמה שאלות (השמות שלכם, תאריך החתונה, סיסמת האורחים) ומרים הכל
עם Docker. פרטים מלאים: [SELF_HOSTING.md](SELF_HOSTING.md).

</div>
