import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(__dirname, "base.css"), "utf8");
const componentsDir = join(__dirname, "..", "components", "ui");

/**
 * The registry primitives style orientation with `data-horizontal:` and
 * `data-vertical:` variants. Base UI emits `data-orientation="horizontal"`,
 * not a bare `data-horizontal` attribute, so those variants match nothing
 * unless the stylesheet defines them — which is how a Separator rendered as
 * a 0×0 box. Pin the definition next to the usages.
 */
describe("orientation variants", () => {
  const users = readdirSync(componentsDir).filter((f) => {
    if (!f.endsWith(".tsx") || f.includes(".test.")) return false;
    return /data-(horizontal|vertical):/.test(readFileSync(join(componentsDir, f), "utf8"));
  });

  it("are used by at least one primitive (otherwise drop the variant)", () => {
    expect(users.length).toBeGreaterThan(0);
  });

  it("are declared as custom variants keyed on data-orientation", () => {
    expect(styles).toMatch(/@custom-variant data-horizontal \(&\[data-orientation="horizontal"\]\)/);
    expect(styles).toMatch(/@custom-variant data-vertical \(&\[data-orientation="vertical"\]\)/);
  });
});

describe("pointer cursor", () => {
  it("gives buttons, links and clickable roles the hand inside the base layer, never on disabled controls", () => {
    const base = styles.slice(styles.indexOf("@layer base {"), styles.indexOf("\n}\n", styles.indexOf("@layer base {")));
    const rule = /:where\(([^)]*)\):not\(:disabled, \[aria-disabled="true"\]\) \{ cursor: pointer; \}/.exec(base);
    expect(rule).not.toBeNull();
    for (const target of ["button", "a[href]", '[role="button"]', '[role="menuitem"]', '[role="treeitem"]', '[role="option"]']) {
      expect(rule?.[1]).toContain(target);
    }
  });
});

describe("caret-blink", () => {
  it("defines the keyframes the OTP fake caret animates with", () => {
    expect(styles).toMatch(/@keyframes caret-blink/);
    expect(styles).toMatch(/\.animate-caret-blink\s*\{/);
  });
});

describe("border-beam", () => {
  it("defines the agent-mode border animation and reduced-motion fallback", () => {
    expect(styles).toMatch(/@keyframes border-beam-rotate/);
    expect(styles).toMatch(/\.border-beam::before\s*\{/);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.border-beam::before \{ animation: none; \}/,
    );
  });
});

/** Body of the first `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlock(): string {
  const start = styles.indexOf("@media (prefers-reduced-motion: reduce)");
  const open = styles.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < styles.length; i++) {
    if (styles[i] === "{") depth++;
    else if (styles[i] === "}" && --depth === 0) return styles.slice(open + 1, i);
  }
  return "";
}

describe("reduced motion", () => {
  // The blanket rule cuts every animation to one fast iteration. A spinner
  // cut that way turns once and freezes, which reads as "done" while the
  // work is still running; it keeps turning, slower, instead.
  it("keeps spinners turning, slowly, past the one-iteration cap", () => {
    const block = reducedMotionBlock();
    expect(block).toMatch(/\*, \*::before, \*::after \{[^}]*animation-iteration-count: 1 !important;/);
    const spin = block.match(/\.animate-spin\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(spin).toMatch(/animation-iteration-count:\s*infinite !important;/);
    const seconds = Number(spin.match(/animation-duration:\s*([\d.]+)s !important;/)?.[1]);
    // Tailwind's spin is one turn a second; reduced motion turns slower.
    expect(seconds).toBeGreaterThan(1);
  });
});

describe("reduced motion transitions", () => {
  // The initial `transition-property` is `all`, so forcing a duration on
  // every element turned each property change (height, padding, font-size)
  // into a 150ms slide on elements that never declared a transition. Reduced
  // motion now makes the default instant and keeps a short fade only where a
  // transition was declared on purpose.
  const block = reducedMotionBlock();

  it("makes undeclared transitions instant instead of creating them", () => {
    const universal = block.match(/\*, \*::before, \*::after \{([^}]*)\}/)?.[1] ?? "";
    expect(universal).toMatch(/transition-duration:\s*0s !important;/);
    expect(universal).not.toMatch(/transition-duration:\s*var\(/);
  });

  it("keeps declared transitions as short opacity and colour feedback only", () => {
    const optIn = block.match(/\[class\*="transition"\]:not\(\[class\*="transition-none"\]\)[^{]*\{([^}]*)\}/)?.[1] ?? "";
    expect(optIn).toMatch(/transition-duration:\s*var\(--duration-fast\) !important;/);
    const property = optIn.match(/transition-property:\s*([^;]*?)\s*!important;/)?.[1] ?? "";
    expect(property.split(/,\s*/)).toEqual(expect.arrayContaining(["opacity", "color", "background-color"]));
    // Nothing that moves or resizes the box survives.
    for (const spatial of ["all", "transform", "translate", "scale", "rotate", "height", "width", "inset"]) {
      expect(property.split(/,\s*/)).not.toContain(spatial);
    }
  });
});

describe("in-card fade", () => {
  // The step/screen fade replays on every step change; it reads the motion
  // tokens (standard 200ms, the quartic ease-out) instead of a 0.4s literal,
  // inside PRODUCT.md's 150–250ms budget for routine transitions.
  it("uses the standard duration and the ease-out token", () => {
    const rule = styles.match(/\.animate-onboarding-enter\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/var\(--duration-standard\)/);
    expect(rule).toMatch(/var\(--ease-out-quart\)/);
    expect(rule).not.toMatch(/\d+(?:\.\d+)?m?s\b/);
  });
});
