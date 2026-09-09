import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolved from the package root rather than `import.meta.url`: the jsdom
// environment rewrites module URLs to a non-file scheme, and vitest always runs
// a package's tests with that package as the working directory.
const css = readFileSync(resolve(process.cwd(), "styles/tokens.css"), "utf8");

/** Nội dung của một khối `selector { ... }` ở cấp cao nhất trong file. */
function block(selector: string): string {
  // Anchored at a line start so a selector mentioned in a comment (".dark"
  // in the header) cannot pass for the block itself.
  const start = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"));
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

/** Tên mọi custom property được ĐỊNH NGHĨA trong một khối. */
function definedVars(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) {
    const [, name] = match;
    if (name) names.add(name);
  }
  return names;
}

/** Giá trị thô của một token trong một khối, ví dụ "#4d8dff" hoặc "oklch(...)". */
function value(selector: string, token: string): string {
  const match = block(selector).match(
    new RegExp(`^\\s*${token}\\s*:\\s*([^;]+);`, "m"),
  );
  if (!match?.[1]) throw new Error(`${token} not found in ${selector}`);
  return match[1].trim();
}

/** sRGB 0..1. Handles the two notations the file uses: #rrggbb and oklch(). */
function srgb(css: string): [number, number, number] {
  const hex = css.match(/^#([0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const ok = css.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!ok) throw new Error(`unsupported colour notation: ${css}`);
  const [L, C, H] = [Number(ok[1]), Number(ok[2]), Number(ok[3])];
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const clamp = (v: number): number => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, g));
  };
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}

/** WCAG relative luminance. */
function luminance(css: string): number {
  const [r, g, b] = srgb(css).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two token values. */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x >= y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

describe("token contract", () => {
  it("declares the Tailwind theme mapping inside the ui package", () => {
    // The mapping must live with the primitives that consume it, otherwise a
    // second app (or a render test) has to duplicate it to render anything.
    expect(css).toContain("@theme inline");
  });

  it("defines the role-named type scale", () => {
    const theme = block("@theme inline");
    for (const step of [
      "--text-micro",
      "--text-caption",
      "--text-label",
      "--text-body",
      "--text-body-lg",
      "--text-title-sm",
      "--text-title",
      "--text-title-lg",
      "--text-display-sm",
      "--text-display",
    ]) {
      expect(definedVars(theme), `missing type step ${step}`).toContain(step);
    }
  });

  it("defines every semantic slot the shadcn primitives consume", () => {
    // Sourced from the 62 primitives in usf packages/ui/components/ui.
    // A missing slot renders as an inherited colour rather than an error, so
    // only an explicit list catches it.
    const REQUIRED = [
      "--background", "--foreground",
      "--card", "--card-foreground",
      "--popover", "--popover-foreground",
      "--primary", "--primary-foreground",
      "--secondary", "--secondary-foreground",
      "--muted", "--muted-foreground", "--faint-foreground",
      "--accent", "--accent-foreground",
      "--destructive", "--success", "--warning", "--info",
      "--brand", "--brand-foreground",
      "--border", "--input", "--ring", "--radius",
      "--app-shell", "--page-canvas",
      "--surface", "--surface-foreground", "--surface-raised",
      "--surface-hover", "--surface-selected",
      "--surface-selected-foreground", "--surface-border",
      "--sidebar", "--sidebar-foreground",
      "--sidebar-primary", "--sidebar-primary-foreground",
      "--sidebar-accent", "--sidebar-accent-foreground",
      "--sidebar-border", "--sidebar-ring",
      "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5",
      "--chat-sender-1", "--chat-sender-2", "--chat-sender-3", "--chat-sender-4",
      "--chat-sender-5", "--chat-sender-6", "--chat-sender-7", "--chat-sender-8",
    ];
    const light = definedVars(block(":root"));
    const missing = REQUIRED.filter((name) => !light.has(name));
    expect(missing, `missing semantic slots: ${missing.join(", ")}`).toEqual([]);
  });

  it("exposes every semantic slot to Tailwind", () => {
    // A slot that exists in :root but has no --color-* alias is unreachable
    // from a utility class, which is the only way primitives consume it.
    const theme = block("@theme inline");
    for (const name of [
      "background", "foreground", "muted-foreground",
      "border", "input", "ring", "sidebar", "chart-1",
    ]) {
      expect(theme, `no Tailwind alias for --${name}`).toContain(`--color-${name}:`);
    }
  });

  it("defines every colour token in both light and dark", () => {
    // Two failures hide here, and neither shows up as an error anywhere else.
    //
    // 1. Adding a token to :root and forgetting .dark. It renders correctly in
    //    whichever theme the author happened to be using and falls back to an
    //    inherited colour in the other one.
    //
    // 2. Assuming a slot written as `var(--something)` tracks the palette on
    //    its own. It does not. Custom properties are computed and then
    //    INHERITED: the var() is resolved where the slot is DECLARED, so a slot
    //    declared on :root carries the light value into every .dark subtree no
    //    matter what .dark does to the token underneath. The onboarding rail —
    //    a dark panel inside a light page — rendered its heading at 1.03:1 that
    //    way. Every themed slot must be restated under .dark, which is why this
    //    check does not exempt var() values.
    const light = definedVars(block(":root"));
    const dark = definedVars(block(".dark"));
    const singleTheme = new Set([
      // Deliberately identical in both themes; see the comment in tokens.css.
      "--rail",
      // Geometry, not colour — nothing for a theme to change.
      "--radius",
    ]);
    const missing = [...light].filter(
      (name) => !dark.has(name) && !singleTheme.has(name),
    );
    expect(missing, `defined in :root but not in .dark: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("has retired the --uw-* palette", () => {
    // The palette was the transitional source the slots pointed at during the
    // base port. Values now live on the slots themselves; a reappearing alias
    // means someone wrote against the old name.
    expect(css).not.toMatch(/--uw-/);
  });

  it("exposes no legacy Tailwind aliases", () => {
    const theme = definedVars(block("@theme inline"));
    const LEGACY = [
      "--color-canvas", "--color-subtle", "--color-text-secondary", "--color-tertiary",
      "--color-inverse", "--color-line", "--color-line-strong", "--color-line-loud",
      "--color-on-brand", "--color-danger", "--color-danger-text",
      "--color-success-text", "--color-warning-text", "--color-brand-soft",
    ];
    const present = LEGACY.filter((name) => theme.has(name));
    expect(present, `legacy aliases still exposed: ${present.join(", ")}`).toEqual([]);
  });

  it("defines the .dark block as a real block, not the :root fallback", () => {
    // Guards block(): if the selector lookup ever regresses to indexOf, .dark
    // resolves to :root and the light/dark comparison becomes vacuous.
    expect(block(".dark")).not.toContain("--rail:");
    expect(block(":root")).toContain("--rail:");
  });
  // The emphasis band is a dark plane whose CONTENT is wrapped in `.dark`, so
  // everything inside resolves from the dark palette while the background
  // itself still tracks the page theme. That makes four token pairs live that
  // no other check covers: the band's own background comes from one block and
  // the text on it from the other.
  //
  // This is a static guard, not the verification. A ratio computed from the
  // file cannot see opacity, a stacked overlay or an image behind the text —
  // e2e/onboarding-contrast.spec.ts measures the rendered page and stays the
  // authority. This one fails in milliseconds when a value is edited blind.
  describe("emphasis band", () => {
    const bandLight = value(":root", "--surface-emphasis");
    const bandDark = value(".dark", "--surface-emphasis");
    // Content inside the band reads the dark palette, on both page themes.
    const onBand = {
      "--foreground": value(".dark", "--foreground"),
      "--muted-foreground": value(".dark", "--muted-foreground"),
      "--brand": value(".dark", "--brand"),
      "--brand-accent": value(".dark", "--brand-accent"),
    };

    for (const [name, colour] of Object.entries(onBand)) {
      it(`keeps ${name} readable on the band in both page themes`, () => {
        for (const [theme, band] of [["light", bandLight], ["dark", bandDark]] as const) {
          const ratio = contrast(colour, band);
          expect(ratio, `${name} on ${theme}-page band: ${ratio.toFixed(2)}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    it("keeps the focus ring visible on the band", () => {
      // The global :focus-visible outline is the only focus indicator in the
      // product and a tested contract. 3:1 is the non-text floor.
      const ring = value(".dark", "--ring");
      for (const [theme, band] of [["light", bandLight], ["dark", bandDark]] as const) {
        const ratio = contrast(ring, band);
        expect(ratio, `--ring on ${theme}-page band: ${ratio.toFixed(2)}`)
          .toBeGreaterThanOrEqual(3);
      }
    });

    it("separates the band from the page it sits on", () => {
      // On a light page the band is an inversion and reads as one outright.
      const light = contrast(bandLight, value(":root", "--background"));
      expect(light, `band vs light page: ${light.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      // On a dark page it is an elevation step, the same order as --surface
      // over --background (1.06), so a ratio is the wrong test: what must hold
      // is the direction. A band that sank below the page would vanish.
      expect(luminance(bandDark)).toBeGreaterThan(luminance(value(".dark", "--background")));
    });

    it("keeps --brand-accent readable on the page itself", () => {
      // Used for eyebrows and icons outside the band too, where the ground is
      // the ordinary page rather than the inverted plane.
      for (const [theme, sel] of [["light", ":root"], ["dark", ".dark"]] as const) {
        const accent = value(sel, "--brand-accent");
        for (const ground of ["--background", "--surface"]) {
          const ratio = contrast(accent, value(sel, ground));
          expect(ratio, `--brand-accent on ${ground} (${theme}): ${ratio.toFixed(2)}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });
});
