---
target: guest gallery
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-10-07T13-21-32Z
slug: web-app-page-tsx
---
Method: dual-agent (A: design review, B: detector + browser)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 2 | Disabled join without reason; viewer "1 / 200" of 598 |
| 2 | Real world | 2 | RTL counter "200 / 1"; LTR Next arrow on the left |
| 3 | Control | 2 | Results can't be kept without tagging; logout beside greeting |
| 4 | Consistency | 2 | Off-brand; tabs clipped at 375px |
| 5 | Error prevention | 2 | One-word name silently disables Enter |
| 6 | Recognition | 2 | Download all hidden in kebab on Mine only |
| 7 | Flexibility | 2 | Long-press select undiscoverable |
| 8 | Aesthetic | 2 | Blank landing, broken grey tiles, repeated name chips |
| 9 | Error recovery | 3 | Wrong-password and selfie errors kind and specific |
| 10 | Help | 2 | Four-step guide never appears |
| Total | | 21/40 | Acceptable |

Specificity: generic with wedding styling on top. No webfonts load (--font-sans empty), gold remap of Tailwind violet, rounded-lg/2xl vs DESIGN.md pill/4px. Detector: undersized text 9-10px (date, "לתמונות" page.tsx:130,817,945), low-contrast 2.7:1 privacy note (page.tsx:1732), cramped tab bar; gray-on-color, image-hover, clipped-overflow, nested-cards are false positives.

Priority issues
- [P1] Landing destroys its first impression: autoFocus (page.tsx:1048) scrolls past hero, Reveal sections never fire (2000px blank), hero.jpg 404, couple names only in 11px footer. onboard.
- [P1] Guest surface ignores brand authority: fonts, palette, radii. colorize + typeset.
- [P1] No direct "see and save my photos" path: results in a modal, keeping them needs tag, Mine, kebab, Download all. distill.
- [P2] Viewer direction bugs and missing aria-labels. harden.
- [P2] Silent join validation; 11px letterspaced Hebrew labels. clarify.

Personas: 70-year-old aunt gets a pre-scrolled empty form and a dead button; groom's friend the morning after can't reach his camera roll without discovering tagging; screen reader users get unlabeled viewer controls.
