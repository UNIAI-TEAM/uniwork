# UniWork brand

The logo, and the rules that keep it one logo.

## What is here

| File | Use |
| --- | --- |
| `logo.tsx` | The `<Logo>` component. Everything in the product goes through it. |
| `svg/` | The artwork, for anything outside the product: decks, print, partners, a designer's Figma. `mark-dark.svg` is the on-dark version. |
| `mark.generated.ts`, `wordmark.generated.ts` | The same artwork as typed data. Generated — do not edit. |
| `assets.lock.json` | Hash of each SVG at the time the rasters were built. Generated. |

## In the product

```tsx
import { Logo } from "@uniwork/ui/brand";

<Logo variant="mark" size={20} />                  // sidebar, rail
<Logo variant="lockup" size={30} />                // auth screens, headers: "uni" + mark + "ork"
<Logo variant="mark" tone="mono" size={20} />      // inherits currentColor
<Logo variant="mark" size={16} decorative />       // aria-hidden
```

**Loading.** A full-page wait is `<LogoLoader label={t("common.loading")} fullScreen />`:
the mark pulsing, no caption. The label reaches screen readers only. Don't
put "Loading…" text under the mark — the pulse already says it.

Set a `size`, not a drawing. At 24px and below the component swaps in the
compact artwork by itself — wider head gap, thicker band, no depth crescent.

**Tones.** `gradient` is the mark as drawn. `flat` is `var(--brand)`, for
one-ink printing and for surfaces where a gradient would compete. `mono` is
`currentColor` — the only tone that survives being dropped inside a button, a
disabled row, or the dark onboarding rail without being restated.

`gradient` swaps to the on-dark ramp by itself. The light ramp's deep end
measures **2.19:1** on the dark sidebar, which erases the left-hand figure and
leaves the mark reading as half a logo; the dark ramp (#4D8DFF) sits beside `--brand`'s dark
value and clears 4.87:1 on that same surface. The swap runs through the `dark:`
variant, not a theme read in JS, so the server-rendered frame is already right.

Outside the product, pick the file: `mark.svg` on light grounds,
`mark-dark.svg` on dark ones, `mark-mono.svg` on anything coloured or busy.

**Decorative or not.** Default announces "UniWork" to screen readers. Pass
`decorative` when the product name is already in the accessible name of
whatever the logo sits in; the app sidebar does, because the workspace switcher
underneath is the region's real label.

## Clear space and minimum size

Clear space is the mark's head radius: `size * LOGO_SAFE_ZONE_RATIO` (14/92 of
the rendered height) on every side, nothing inside it. The number comes off the
artwork, so it stays correct if the mark is redrawn.

Minimums (`LOGO_MIN_SIZE`): mark 16px, wordmark and lockup 16px high (about
84px wide), stacked lockup 40px. Below these the head gap closes and the wave
turns to texture.

## The wordmark

"uni", the mark, "ork" (2026-09-17): the mark stands in for the w. The letters
are Plus Jakarta Sans ExtraBold, lower case, the product's own display face,
outlined to paths. The mark is as tall as the k: top on its ascender, bottom on
the baseline less the round letters' overshoot, with one fixed gap either side on
top of the letters' sidebearings. `lockup` is the word with the mark in its tone;
`wordmark` is the single-ink version, mark included.

## Don't

- **Don't put the logo gradient on anything but the logo.** It is deliberately
  not a CSS token: `PRODUCT.md` lists gradient chrome as an anti-reference, and
  a token would put it one utility class away from a card background.
  `scripts/brand-assets.test.mjs` fails if those hexes appear in `tokens.css`.
- Don't rotate, skew, or add a shadow.
- Don't rebuild the lockup by placing the mark and the wordmark by hand — the
  spacing is generated. Use `variant="lockup"`.
- Don't put the full-colour mark on a busy photo or a mid-tone fill. Use `mono`.
- Don't retype the wordmark, and don't place the mark between typed "uni" and
  "ork". The spacing and the mark's height are generated from the letters.
- Don't put the light-ramp mark on a dark ground by hand. Use `<Logo>`, which
  swaps ramps, or `mark-dark.svg`.

## The mark

Rebuilt from the original artwork on a 128×92 grid, with four corrections that
the measurements justified. They are recorded in
`docs/superpowers/specs/2026-08-26-brand-identity-design.md`, and the shortest
version is: the original's head-to-body gap was 0.3% of the mark's height, which
merges into one blob below about 32px.

One constraint governs the wave. The ribbon is a constant-perpendicular-width
band around a raised cosine, and an inner offset cusps once the offset reaches
the centreline's radius of curvature. `Mark.cusp_margin()` reports the
clearance; `build-svg.py` refuses to write a mark below 3 units, because at that
point the valleys and the underside of the crest come to visible points.

## Regenerating

```bash
pnpm brand:build                          # mark + rasters
BRAND_FONT_TTF=/path/to/PlusJakartaSans[wght].ttf pnpm brand:build   # + wordmark, lockups, link previews
```

Three steps: `build-svg.py` draws the mark, `build-assets.mjs` rasterises it in
Chromium, `squeeze.py` re-encodes the output. The squeeze is not cosmetic —
Chromium writes PNGs at zlib's default level with no filter search, and the pass
takes the shipped icons from 422 KB to 137 KB.

Needs `python3` with `fonttools` and `pillow`. Chromium comes from the repo's
Playwright install. The wordmark and link-preview steps are skipped without
`BRAND_FONT_TTF` — their output is committed, so a mark-only change does not
need the font. Pin the font file you rebuild the wordmark with: a newer Plus
Jakarta release moves the outlines by fractions of a unit.
Plus Jakarta Sans is OFL-licensed (google/fonts, `ofl/plusjakartasans`); the
variable file is fine, the build instances the weights it needs. The binary is not
committed because nothing at runtime reads it.

Changing the mark means editing `scripts/brand/geometry.py`, never the SVGs.

## Link previews

What Slack, X, LinkedIn, Telegram, iMessage and WhatsApp show for a pasted
UniWork URL. Four 1200×630 cards, one layout (`scripts/brand/og-cards.mjs`):
the lockup, a two-line headline, a subline, and on the right the product's own
objects — a task a person and UNI own together, a live meeting, Ask UNI — in
the product's tint and signal colours with lucide icons.

| Card | File | Used by |
| --- | --- | --- |
| Your team. One workspace. | `apps/web/app/opengraph-image.png` | every page without its own card |
| You're invited to a meeting. | `apps/web/public/brand/og/meeting-invite.png` | `/invite/meeting/*` |
| You're invited to join the team. | `apps/web/public/brand/og/workspace-invite.png` | `/invite/*` |
| A document, shared with you. | `apps/web/public/brand/og/shared-document.png` | `/share/*` |

- **English, always.** A crawler sends no locale cookie, and English is the
  product default for that request. The cards speak to a team anywhere.
- **Nothing behind the link's secret.** Invite and share previews never name
  the meeting, workspace or document: an unfurl prints them for a whole
  channel.
- **Pages name their card.** `apps/web/platform/share-metadata.ts` writes
  title, description, Open Graph and Twitter tags from one copy and points at
  the card through `og-image.generated.ts`. A segment that sets `openGraph`
  otherwise loses the root card Next wires by file convention.
- **A changed card is a changed URL.** Unfurlers cache images for weeks; each
  URL carries `?v=` from the card's own HTML.
- The cards are PNG: flat fields and type are smaller and exact in PNG (~80 KB
  each), under the ~300 KB WhatsApp will preview.

Editing the copy or layout means rebuilding with the font;
`brand-assets.test.mjs` fails while `og-cards.mjs` and the lock disagree.
