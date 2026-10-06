// UNI-927 X6 (X5-review F4): the slide-show control bar stays WCAG AA (4.5:1)
// at idle opacity, over the worst-case stage (a white slide and a black stage),
// in the light and dark token sets. Computed from tokens.css, not eyeballed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../../../ui/styles/tokens.css"), "utf8");
const source = readFileSync(resolve(__dirname, "pptx-slide-show.tsx"), "utf8");

type Rgba = [number, number, number, number];

/** The nth declaration of a token: 0 = :root (light), 1 = .dark. */
function token(name: string, nth: number): Rgba {
  const values = [...css.matchAll(new RegExp(`--${name}: *([^;]+);`, "g"))].map((m) => m[1]!.trim());
  const raw = values[nth];
  if (!raw) throw new Error(`token --${name} #${nth} missing`);
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as Rgba;
  const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(raw);
  if (!fn) throw new Error(`token --${name}: cannot parse "${raw}"`);
  return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
}

/** `top` (with its alpha, scaled by `opacity`) over an opaque `under`. */
const over = (top: Rgba, under: [number, number, number], opacity = 1): [number, number, number] => {
  const a = top[3] * opacity;
  return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)) as [number, number, number];
};
const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const idleOpacity = Number(/\bopacity-(\d+)\b/.exec(source.slice(source.indexOf("data-pptx-show-controls") - 400))?.[1]) / 100;

describe("slide-show control bar contrast at idle (X5-review F4)", () => {
  it("reads the idle opacity the component actually uses", () => {
    expect(idleOpacity).toBeGreaterThan(0.5);
    expect(idleOpacity).toBeLessThanOrEqual(1);
  });

  it.each([
    { mode: "light tokens", nth: 0 },
    { mode: "dark tokens", nth: 1 },
  ])("keeps the counter and chip labels >= 4.5:1 over a white slide and a black stage ($mode)", ({ nth }) => {
    // The counter is meeting-bar-foreground; chips are meeting-bar-foreground on a chip fill.
    const foreground = token("meeting-bar-foreground", nth);
    for (const stage of [[255, 255, 255], [0, 0, 0]] as Array<[number, number, number]>) {
      const bar = over(token("meeting-bar-bg", nth), stage, idleOpacity);
      const counter = over(foreground, bar, idleOpacity);
      expect(contrast(counter, bar), `counter over ${stage.join(",")}`).toBeGreaterThanOrEqual(4.5);
      const chipBg = over(token("meeting-bar-chip-bg", nth), bar, idleOpacity);
      const chipText = over(foreground, chipBg, idleOpacity);
      expect(contrast(chipText, chipBg), `chip over ${stage.join(",")}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("would have failed with the old muted counter at opacity 70", () => {
    const stage: [number, number, number] = [255, 255, 255];
    const bar = over(token("meeting-bar-bg", 0), stage, 0.7);
    const counter = over(token("meeting-bar-muted-foreground", 0), bar, 0.7);
    expect(contrast(counter, bar)).toBeLessThan(4.5);
  });
});
