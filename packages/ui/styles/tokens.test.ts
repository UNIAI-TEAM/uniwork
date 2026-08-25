import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolved from the package root rather than `import.meta.url`: the jsdom
// environment rewrites module URLs to a non-file scheme, and vitest always runs
// a package's tests with that package as the working directory.
const css = readFileSync(resolve(process.cwd(), "styles/tokens.css"), "utf8");

/** Nội dung của một khối `selector { ... }` ở cấp cao nhất trong file. */
function block(selector: string): string {
  const start = css.indexOf(selector);
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
  return new Set(
    [...source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
  );
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

  it("defines every colour token in both light and dark", () => {
    // The classic failure is adding a token to :root and forgetting .dark — it
    // renders correctly in whichever theme the author happened to be using and
    // falls back to an inherited colour in the other one.
    const light = definedVars(block(":root"));
    const dark = definedVars(block(".dark"));
    const singleTheme = new Set([
      // Deliberately identical in both themes; see the comments in tokens.css.
      "--uw-rail-bg",
      "--uw-radius",
    ]);
    const missing = [...light].filter(
      (name) => !dark.has(name) && !singleTheme.has(name),
    );
    expect(missing, `defined in :root but not in .dark: ${missing.join(", ")}`)
      .toEqual([]);
  });
});
