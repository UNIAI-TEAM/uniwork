import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Contrast of a rendered primitive, measured from the classes it ships and the
 * values in tokens.css. Translucent fills are composited (sRGB alpha) over the
 * plane they land on, which is what the browser paints.
 */

const tokens = readFileSync(resolve(process.cwd(), "styles/tokens.css"), "utf8");

export type Rgb = [number, number, number];
export type Scope = ":root" | ".dark";

function block(selector: Scope): string {
  const start = tokens.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  return tokens.slice(start, tokens.indexOf("\n}", start));
}

/** A slot's colour in one theme block; only #rrggbb slots are measurable here. */
export function slot(scope: Scope, name: string): Rgb {
  const match = block(scope).match(new RegExp(`^\\s*--${name}:\\s*#([0-9a-fA-F]{6});`, "m"));
  if (!match?.[1]) throw new Error(`--${name} is not a hex colour in ${scope}`);
  const hex = match[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
}

function isSlot(name: string): boolean {
  return new RegExp(`^\\s*--${name}:\\s*#`, "m").test(block(":root"));
}

/** sRGB alpha compositing of `fg` at `alpha` over `bg`. */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;
}

function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ColourUtility {
  name: string;
  alpha: number;
}

/**
 * The first class with `prefix` that names a colour slot: `bg-muted/50` →
 * { name: "muted", alpha: 0.5 }. Classes that are not colours (`text-body`,
 * `bg-clip-padding`) are skipped.
 */
export function colourUtility(classes: string[], prefix: string): ColourUtility {
  for (const c of classes) {
    if (!c.startsWith(prefix)) continue;
    const [name, pct] = c.slice(prefix.length).split("/");
    if (!name || !isSlot(name)) continue;
    return { name, alpha: pct ? Number(pct) / 100 : 1 };
  }
  throw new Error(`no ${prefix}<colour> class in "${classes.join(" ")}"`);
}

/** Text over a fill, both from utilities, the fill painted over `base`. */
export function measure(scope: Scope, text: ColourUtility, fill: ColourUtility, base: Rgb): number {
  const painted = over(slot(scope, fill.name), fill.alpha, base);
  const ink = over(slot(scope, text.name), text.alpha, painted);
  return contrast(ink, painted);
}

/** The planes a notice or an action lands on, per theme. */
export function planes(scope: Scope): Record<string, Rgb> {
  const raised = slot(scope, "surface-raised");
  return {
    background: slot(scope, "background"),
    "card / surface-raised": raised,
    "dialog footer": over(slot(scope, "surface-hover"), 0.7, raised),
    muted: slot(scope, "muted"),
  };
}
