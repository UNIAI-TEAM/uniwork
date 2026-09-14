/**
 * Accent themes — the second axis of theming, orthogonal to light/dark.
 *
 * Light/dark is next-themes' job (`.dark` on <html>). The accent only moves the
 * BRAND slots: `--brand`, `--ring`, the sidebar's primary pair and the selected
 * surface. Everything else — canvas, borders, signal colours, module tints —
 * stays put, so a re-accented app still reads as UniWork.
 *
 * One table, one source of truth. The picker's swatch and the CSS derivation in
 * `styles/tokens.css` both read these four numbers off <html> as custom
 * properties; tokens.css never repeats a hex. `violet` is the palette already
 * baked into `:root` / `.dark`, so selecting it removes the attribute entirely
 * rather than re-deriving the same colour through oklch().
 *
 * `l` / `lDark` are per-accent, not one constant, for two reasons. The ramp is
 * not linear at the ends — `black` has to sit near-ink in light and near-paper
 * in dark, where every hued accent stays mid-range. And equal lightness across
 * hues does not mean equal contrast: at l 0.55 the yellow-green band (orange,
 * mint) fell to 4.31:1 as text on its own tint while violet held 5.51, so those
 * two are pinned lower. `lib/accent.contrast.test.ts` re-measures all of it.
 */

export type Accent = {
  /** oklch hue angle. */
  h: number;
  /** oklch chroma. `black` is ~0 on purpose. */
  c: number;
  /** oklch lightness of `--brand` in the light theme. */
  l: number;
  /** oklch lightness of `--brand` in the dark theme. */
  lDark: number;
};

/** Insertion order is the order of the picker grid. */
export const ACCENTS = {
  black: { h: 285, c: 0.014, l: 0.26, lDark: 0.93 },
  purple: { h: 292, c: 0.19, l: 0.52, lDark: 0.8 },
  blue: { h: 248, c: 0.17, l: 0.52, lDark: 0.8 },
  pink: { h: 353, c: 0.19, l: 0.55, lDark: 0.8 },
  violet: { h: 300, c: 0.28, l: 0.52, lDark: 0.78 },
  indigo: { h: 268, c: 0.19, l: 0.5, lDark: 0.79 },
  orange: { h: 52, c: 0.16, l: 0.535, lDark: 0.8 },
  teal: { h: 195, c: 0.1, l: 0.5, lDark: 0.8 },
  bronze: { h: 45, c: 0.05, l: 0.52, lDark: 0.8 },
  mint: { h: 165, c: 0.11, l: 0.51, lDark: 0.82 },
} satisfies Record<string, Accent>;

export type AccentName = keyof typeof ACCENTS;

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

/** The accent `:root` / `.dark` already hold; it needs no override block. */
export const DEFAULT_ACCENT: AccentName = "violet";

export const ACCENT_STORAGE_KEY = "uniwork-accent";

export function isAccentName(value: unknown): value is AccentName {
  return typeof value === "string" && value in ACCENTS;
}

/**
 * The four colours one swatch in the picker needs, as custom properties.
 *
 * A swatch that only ever showed the LIGHT brand was wrong twice over: the
 * near-ink `black` dot measured 1.14:1 on the dark card and was invisible, and
 * every dot promised a colour the dark theme would not actually apply — pick
 * `black` in dark mode and the brand is near-WHITE. These are the exact values
 * the accent blocks derive, so the dot shows what the click will do.
 *
 * Returned as properties rather than a resolved colour because the component
 * must not read the active theme: that value is unknown during SSR, and a
 * `style` attribute that differs between server and client is a hydration
 * mismatch. CSS picks the pair instead, off `.dark`, with no JS involved.
 */
export function accentSwatchVars(name: AccentName): Record<string, string> {
  const { h, c, l, lDark } = ACCENTS[name];
  return {
    "--sw": `oklch(${l} ${c} ${h})`,
    "--sw-dark": `oklch(${lDark} ${c * 0.55} ${h})`,
    // Matches --brand-foreground: white on the light fill, near-ink on the dark.
    "--sw-ink": "#ffffff",
    "--sw-ink-dark": `oklch(0.17 ${c * 0.3} ${h})`,
  };
}

/**
 * Writes the accent onto <html>. `data-accent` is the switch tokens.css keys
 * off; the four properties are the numbers it derives from. The default accent
 * clears both so the base palette applies unmodified.
 */
export function applyAccent(name: AccentName, root: HTMLElement): void {
  if (name === DEFAULT_ACCENT) {
    root.removeAttribute("data-accent");
    for (const prop of ["--accent-h", "--accent-c", "--accent-l", "--accent-l-dark"]) {
      root.style.removeProperty(prop);
    }
    return;
  }
  const { h, c, l, lDark } = ACCENTS[name];
  root.setAttribute("data-accent", name);
  root.style.setProperty("--accent-h", String(h));
  root.style.setProperty("--accent-c", String(c));
  root.style.setProperty("--accent-l", String(l));
  root.style.setProperty("--accent-l-dark", String(lDark));
}

export function readStoredAccent(): AccentName {
  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentName(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    // Private mode / blocked storage: the default accent is a fine answer.
    return DEFAULT_ACCENT;
  }
}

/**
 * Runs before first paint, from a blocking inline <script> in the document
 * head — the same trick next-themes uses for `.dark`. Without it the app paints
 * one frame of violet before React mounts and repaints in the chosen accent.
 * Serialised as a string because it must not wait for a bundle.
 */
export function accentBootScript(): string {
  return `(function(){try{var a=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});var t=${JSON.stringify(ACCENTS)};if(!a||a===${JSON.stringify(DEFAULT_ACCENT)}||!t[a])return;var e=document.documentElement,v=t[a];e.setAttribute("data-accent",a);e.style.setProperty("--accent-h",v.h);e.style.setProperty("--accent-c",v.c);e.style.setProperty("--accent-l",v.l);e.style.setProperty("--accent-l-dark",v.lDark);}catch(_){}})()`;
}
