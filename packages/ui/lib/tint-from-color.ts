import { TINTS, type Tint } from "@uniwork/ui/components/common/icon-tile";

/** Hue centre of each chromatic tint, degrees. Gray is chosen by saturation. */
const HUE_CENTRES: ReadonlyArray<[Tint, number]> = [
  ["red", 0],
  ["orange", 22],
  ["yellow", 45],
  ["green", 140],
  ["teal", 175],
  ["blue", 215],
  ["violet", 275],
  ["pink", 320],
  ["red", 360],
];

/**
 * Maps a stored colour (a label's `#rrggbb` chosen by a user or seeded by the
 * server) onto the nearest tint so user data still renders through tokens
 * instead of raw hex. Anything unparsable, or too grey to have a hue, is gray.
 */
export function tintFromColor(color: string | null | undefined): Tint {
  const m = /^#?([0-9a-f]{6})$/i.exec((color ?? "").trim());
  if (!m) return "gray";
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.12) return "gray";
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  let best: Tint = "gray";
  let bestDist = Infinity;
  for (const [tint, centre] of HUE_CENTRES) {
    const dist = Math.abs(h - centre);
    if (dist < bestDist) {
      bestDist = dist;
      best = tint;
    }
  }
  return TINTS.includes(best) ? best : "gray";
}
