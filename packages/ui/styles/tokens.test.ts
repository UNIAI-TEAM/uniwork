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
  // Anchored at a line start OR after a `;`: the type scale packs several
  // declarations on one line so the size, leading and tracking of a step
  // read together.
  for (const match of source.matchAll(/(?:^|;)\s*(--[a-z0-9-]+)\s*:/gm)) {
    const [, name] = match;
    if (name) names.add(name);
  }
  return names;
}

const TINTS = ["violet", "blue", "pink", "orange", "green", "yellow", "teal", "gray", "red"] as const;

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

  it("carries leading and tracking on every title, display and hero step", () => {
    // The ClickUp-derived scale tracks headings negatively; a step that only
    // sets a size renders with Tailwind's default tracking and reads looser
    // than its neighbours. Body steps deliberately keep default tracking.
    const theme = definedVars(block("@theme inline"));
    for (const step of [
      "title-sm", "title", "title-lg", "display-sm", "display",
      "hero-sm", "hero", "hero-lg",
    ]) {
      expect(theme, `missing line-height for ${step}`).toContain(`--text-${step}--line-height`);
      expect(theme, `missing letter-spacing for ${step}`).toContain(`--text-${step}--letter-spacing`);
    }
  });

  it("exposes the three families and no serif", () => {
    // Plus Jakarta Sans carries headings, Inter carries copy and controls,
    // JetBrains Mono carries taxonomy labels (Sometype Mono ships no
    // Vietnamese subset). Source Serif was retired with the ClickUp rework;
    // a surviving alias means a view still asks for it.
    const theme = definedVars(block("@theme inline"));
    expect(theme).toContain("--font-sans");
    expect(theme).toContain("--font-display");
    expect(theme).toContain("--font-mono");
    expect(theme).not.toContain("--font-serif");
    expect(css).not.toMatch(/source-serif/);
  });

  it("pins the radius ramp to explicit values", () => {
    // sm 6 / md 8 / lg 12 / xl 14 / 2xl 20 / 3xl 32. A calc() ramp off one
    // base drifts every step when the base moves; explicit stops do not.
    const theme = block("@theme inline");
    for (const [step, px] of [
      ["sm", "6px"], ["md", "8px"], ["lg", "12px"],
      ["xl", "14px"], ["2xl", "20px"], ["3xl", "32px"],
    ]) {
      expect(theme).toMatch(new RegExp(`--radius-${step}:\\s*${px};`));
    }
  });

  it("makes headings take the display family without touching views", () => {
    // 57 call sites use text-title*/text-display*/text-hero*; the family
    // rides on the utility so none of them has to add font-display.
    for (const cls of ["text-title-sm", "text-title", "text-title-lg",
      "text-display-sm", "text-display", "text-hero-sm", "text-hero", "text-hero-lg"]) {
      expect(css, `${cls} not bound to --font-display`).toMatch(
        new RegExp(`\\.${cls.replace(/-/g, "-")}\\b[^{]*\\{[^}]*font-family:\\s*var\\(--font-display\\)`),
      );
    }
  });

  it("defines the nine tints as fill + foreground + solid triples", () => {
    // Tints identify modules (tasks, meetings, chat…); signal colours report
    // state. A tint without its foreground forces a view to pick a glyph
    // colour by hand, which is how contrast drifts.
    const light = definedVars(block(":root"));
    const theme = definedVars(block("@theme inline"));
    for (const hue of TINTS) {
      expect(light, `missing --tint-${hue}`).toContain(`--tint-${hue}`);
      expect(light, `missing --tint-${hue}-foreground`).toContain(`--tint-${hue}-foreground`);
      expect(theme, `no Tailwind alias for tint-${hue}`).toContain(`--color-tint-${hue}`);
      expect(theme, `no Tailwind alias for tint-${hue}-foreground`).toContain(`--color-tint-${hue}-foreground`);
      expect(light, `missing --tint-${hue}-solid`).toContain(`--tint-${hue}-solid`);
      expect(theme, `no Tailwind alias for tint-${hue}-solid`).toContain(`--color-tint-${hue}-solid`);
    }
    expect(light).toContain("--on-solid");
    expect(theme).toContain("--color-on-solid");
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
});
