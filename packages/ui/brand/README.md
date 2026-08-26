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
<Logo variant="lockup" size={30} />                // auth screens, headers
<Logo variant="mark" tone="mono" size={20} />      // inherits currentColor
<Logo variant="mark" size={16} decorative />       // aria-hidden
```

Set a `size`, not a drawing. At 24px and below the component swaps in the
compact artwork by itself — wider head gap, thicker band, no depth crescent.

**Tones.** `gradient` is the mark as drawn. `flat` is `var(--brand)`, for
one-ink printing and for surfaces where a gradient would compete. `mono` is
`currentColor` — the only tone that survives being dropped inside a button, a
disabled row, or the dark onboarding rail without being restated.

`gradient` swaps to the on-dark ramp by itself. The light ramp's deep end
measures **2.19:1** on the dark sidebar, which erases the left-hand figure and
leaves the mark reading as half a logo; the dark ramp starts at `--brand`'s dark
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

Minimums (`LOGO_MIN_SIZE`): mark 16px, wordmark 12px, lockup 22px high (about
94px wide), stacked lockup 32px. Below these the head gap closes and the wave
turns to texture.

## Don't

- **Don't put the logo gradient on anything but the logo.** It is deliberately
  not a CSS token: `PRODUCT.md` lists gradient chrome as an anti-reference, and
  a token would put it one utility class away from a card background.
  `scripts/brand-assets.test.mjs` fails if those hexes appear in `tokens.css`.
- Don't rotate, skew, or add a shadow.
- Don't rebuild the lockup by placing the mark and the wordmark by hand — the
  spacing is generated. Use `variant="lockup"`.
- Don't put the full-colour mark on a busy photo or a mid-tone fill. Use `mono`.
- Don't retype the wordmark in Inter. The W's feet are custom; typed text is a
  different mark.
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
INTER_TTF=/path/to/Inter-SemiBold.ttf pnpm brand:build   # + wordmark and lockups
```

Three steps: `build-svg.py` draws the mark, `build-assets.mjs` rasterises it in
Chromium, `squeeze.py` re-encodes the output. The squeeze is not cosmetic —
Chromium writes PNGs at zlib's default level with no filter search, and the pass
takes the shipped rasters from 422 KB to 137 KB. It also converts the Open Graph
card to JPEG, which is why `apps/web/app/` holds `opengraph-image.jpg`.

Needs `python3` with `fonttools` and `pillow`. Chromium comes from the repo's
Playwright install. The wordmark step is skipped without `INTER_TTF` — its outlines are
already committed, so a mark-only change does not need the font. Inter is
OFL-licensed; the binary is not committed because nothing at runtime reads it.

Changing the mark means editing `scripts/brand/geometry.py`, never the SVGs.
