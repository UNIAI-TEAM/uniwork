import { describe, expect, it } from "vitest";
import { ACCENTS, type Accent } from "./accent";

/**
 * Measures the accent ramp the way the browser will render it.
 *
 * The e2e contrast specs (`e2e/*-contrast.spec.ts`) measure the RENDERED page,
 * which is the stronger check and stays the one that catches a class-merge bug.
 * They cannot cover this: they see one accent at a time, and the accent grid has
 * ten. So this re-derives the same colours `tokens.css` computes from the table
 * and holds every one of them to the WCAG floor, in both themes, with no app,
 * no Postgres and no browser.
 *
 * Equal lightness across hues is NOT equal contrast. At l 0.55 the yellow-green
 * band (orange, mint) measured 4.31:1 as text on its own selected tint while
 * violet held 5.51 at the same lightness. Both were shipped, both were wrong,
 * and nothing else in the repo would have said so.
 */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const encode = (u: number) => clamp01(u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055);
const decode = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);

type Rgb = [number, number, number];

function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToOklab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(decode) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * `oklch()` with the browser's gamut mapping. A hue at high chroma can land
 * outside sRGB; the browser reduces chroma until it fits rather than clipping
 * each channel, and clipping instead would measure a colour nobody sees.
 */
function oklch(L: number, C: number, H: number): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const inGamut = (v: Rgb) => v.every((x) => x >= -1e-4 && x <= 1 + 1e-4);
  let out = oklabToLinear(L, a, b);
  if (!inGamut(out)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const t = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, a * t, b * t))) lo = t;
      else hi = t;
    }
    out = oklabToLinear(L, a * lo, b * lo);
  }
  return out.map(encode) as Rgb;
}

const hex = (s: string): Rgb => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as Rgb;

/** `color-mix(in oklab, top p%, bottom)`, the function tokens.css uses. */
function mix(top: Rgb, bottom: Rgb, p: number): Rgb {
  const A = linearToOklab(top);
  const B = linearToOklab(bottom);
  return oklabToLinear(...(A.map((v, i) => v * p + B[i]! * (1 - p)) as [number, number, number]))
    .map(encode) as Rgb;
}

function luminance(c: Rgb): number {
  const [r, g, b] = c.map(decode) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Slot values copied from tokens.css. They are the surfaces the accent lands on.
const LIGHT = { bg: hex("#f8f9fa"), surface: hex("#ffffff"), muted: hex("#f1f1f9") };
const DARK = { bg: hex("#111111"), surface: hex("#181818"), muted: hex("#262626") };
const WHITE = hex("#ffffff");

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** The same derivations `html:not(.dark)[data-accent]` / `html.dark[data-accent]` do. */
const lightBrand = (a: Accent) => oklch(a.l, a.c, a.h);
const darkBrand = (a: Accent) => oklch(a.lDark, a.c * 0.55, a.h);
const darkBrandInk = (a: Accent) => oklch(0.17, a.c * 0.3, a.h);

const entries = Object.entries(ACCENTS) as [string, Accent][];
const round = (n: number) => Math.round(n * 100) / 100;

describe("accent contrast", () => {
  it.each(entries)("%s reads as text in the light theme", (_name, a) => {
    const brand = lightBrand(a);
    // --brand is a text colour, not just a fill: `text-brand` sits on the page,
    // on cards and on utility panels, and --muted is the tightest of the three.
    expect(round(contrast(brand, LIGHT.muted))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(round(contrast(brand, LIGHT.bg))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(round(contrast(brand, LIGHT.surface))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(entries)("%s carries a white label on its own fill", (_name, a) => {
    // --brand-foreground stays #ffffff in light; a primary button is this pair.
    expect(round(contrast(WHITE, lightBrand(a)))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(entries)("%s reads on its own selected tint, light", (_name, a) => {
    // The pattern is `text-brand` on `bg-surface-selected`, which the accent
    // blocks derive as an 11% mix of the brand into white. The tint moves WITH
    // the text colour, so this is the tightest pair in the whole ramp.
    const brand = lightBrand(a);
    expect(round(contrast(brand, mix(brand, WHITE, 0.11)))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(entries)("%s reads as text in the dark theme", (_name, a) => {
    const brand = darkBrand(a);
    expect(round(contrast(brand, DARK.muted))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(round(contrast(brand, DARK.bg))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(round(contrast(brand, DARK.surface))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(entries)("%s pairs with a readable foreground in the dark theme", (_name, a) => {
    const brand = darkBrand(a);
    expect(round(contrast(darkBrandInk(a), brand))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(round(contrast(brand, mix(brand, DARK.bg, 0.24)))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps every accent distinguishable from the next", () => {
    // Ten swatches in one grid: two that measure the same are two that a
    // colour-blind user cannot tell apart, and the label is then the only cue.
    const seen = new Set(entries.map(([, a]) => round(luminance(lightBrand(a)) * 1000)));
    expect(seen.size).toBe(entries.length);
  });

  it("holds the non-text floor for the ring", () => {
    // --ring follows --brand and outlines controls; WCAG 1.4.11 wants 3:1
    // against what surrounds it, which is the page in both themes.
    for (const [name, a] of entries) {
      expect(round(contrast(lightBrand(a), LIGHT.bg)), `${name} ring, light`).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(round(contrast(darkBrand(a), DARK.bg)), `${name} ring, dark`).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });
});
