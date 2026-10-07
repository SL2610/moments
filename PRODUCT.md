# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Guests:** wedding guests of every age, Hebrew first, on their own phone. They scan a QR card at the hall at night or open a WhatsApp link the next morning. Many are older relatives on poor reception. Their job: find the photos they appear in and save them.
- **The couple:** sets up the gallery, imports the photographer's photos, moderates, and shares the QR and link. Non-technical by default.

## Product Purpose

A self-hostable wedding gallery where each guest finds their own photos with one selfie. Success: a guest goes from scanning to saving their photos without typing anything.

## Positioning

Open source and self-hostable, so the couple owns the photos and the face data; nothing is sold or reused. The selfie is never stored.

## Operating Context

- The photographer's photos are the main source and drive selfie search. Guest uploads are secondary ("From guests").
- On a CPU server, photos are indexed in the hours after the wedding, so the main visit is the morning after, from a WhatsApp link.
- Each wedding runs as its own Docker stack behind a Cloudflare Tunnel.

## Capabilities and Constraints

- Guest entry is selfie first: the link is the key, the shared password is optional, and a name is asked only when the guest uploads or tags.
- Guest identity is anonymous, held by the browser; on a new device a new selfie brings the photos back. No phone or other contact detail is collected.
- After a selfie, the guest's own photos are the home screen, with "save all" up front; the full album is one tap away.
- Hebrew/RTL is the default; English is complete.
- Per-event identity comes from env (`EVENT_NAME`, `EVENT_DATE`) and `data/branding/` images.
- The guest pages belong to the couple: their cover photo and names lead, styled as their own invitation. The Moments mark never appears there; Moments is only the small "Made with Moments" credit.

## Brand Commitments

Name: **Moments**. Visual identity follows the "Editorial Invitation" direction shared with the product site (ivory paper, ink, forest and oxblood accents, Instrument Serif/Archivo with Frank Ruhl Libre/Assistant). It must never read as a generic AI-generated wedding template.

## Evidence on Hand

No real wedding photos, testimonials or customer data in this repo. Test content is the synthetic LFW golden set (`ai-face-worker/eval/build_golden.py`). Do not fabricate testimonials or metrics.

## Product Principles

- Zero typing before the first result.
- The guest's own photos come before everything else.
- Works for the least technical person at the wedding.
- Privacy is concrete and checkable, not a slogan.

## Accessibility & Inclusion

Older guests in dim halls: minimum 14px functional text, no letter-spacing on Hebrew, 44px touch targets, labeled icon buttons, WCAG AA contrast.
