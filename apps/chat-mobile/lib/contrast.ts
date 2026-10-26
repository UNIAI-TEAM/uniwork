// WCAG 2.x contrast between two of the app's colours (lib/theme.ts writes
// every token as `hsl(h s% l%)`). Used by theme-contrast.test.ts to hold the
// text/background pairs of both modes at AA, the check the web runs on the
// rendered page (e2e/onboarding-contrast.spec.ts) and the phone runs on its tokens.

/** An `hsl(h s% l%)` token as sRGB channels in 0–1; throws on anything else, so a new token format cannot pass unread. */
export function hslToRgb(token: string): [number, number, number] {
  const match = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(token);
  if (!match) throw new Error(`not an hsl() token: ${token}`);
  const h = Number(match[1]);
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

/** Relative luminance (WCAG 2.x). */
export function relativeLuminance(token: string): number {
  const [r = 0, g = 0, b = 0] = hslToRgb(token).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two tokens, 1 to 21, in either order. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
