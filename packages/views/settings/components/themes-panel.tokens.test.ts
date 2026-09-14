import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOCK, MOCK_TOKENS } from "./themes-panel";

/**
 * The appearance tiles draw a miniature app window, and a picture of the light
 * theme has to stay light while the app is dark. So the mock carries both
 * palettes as literal hex instead of reading `var(--page-canvas)`, which is the
 * one place in the app allowed to write a colour by hand.
 *
 * That copy is the whole risk. Nothing links it back to the palette, so the day
 * someone retunes `--sidebar` the preview keeps painting last year's grey and
 * no test, type or lint says a word. This is that word.
 */

const css = readFileSync(
  resolve(process.cwd(), "../ui/styles/tokens.css"),
  "utf8",
);

/** Value of one custom property inside a top-level `selector { ... }` block. */
function tokenIn(selector: string, name: string): string | null {
  const start = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"));
  if (start === -1) return null;
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = css.length;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+);`, "m").exec(css.slice(open + 1, end));
  return match?.[1]?.trim() ?? null;
}

describe("appearance preview colours", () => {
  it.each([
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const)("%s tile matches the %s palette", (tone, selector) => {
    for (const [part, token] of Object.entries(MOCK_TOKENS)) {
      const expected = tokenIn(selector, token);
      expect(expected, `${token} not found in ${selector}`).not.toBeNull();
      expect(MOCK[tone][part as keyof typeof MOCK.light], `${tone}.${part} drifted from ${token}`)
        .toBe(expected);
    }
  });

  it("guards the block lookup", () => {
    // If the selector search ever regresses, both blocks resolve to the same
    // text and the two assertions above compare light against light.
    expect(tokenIn(":root", "--card")).not.toBe(tokenIn(".dark", "--card"));
  });
});
