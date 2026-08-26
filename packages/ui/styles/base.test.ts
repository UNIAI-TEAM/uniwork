import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "styles/base.css"), "utf8");

/**
 * Chrome paints its own background and text colour into an autofilled input and
 * ignores `background-color`. Left alone it drops a pale blue box into the
 * credential form — the one screen a signed-out visitor sees — and in dark mode
 * it lands light-on-light. The override has to exist, has to be painted with
 * `box-shadow` (the only property that wins), and has to read tokens so it
 * follows the theme instead of pinning one hex.
 */
describe("autofill contract", () => {
  const rules = css.match(/[^}]*-webkit-autofill[^{]*\{[^}]*\}/g) ?? [];

  it("overrides the browser's autofill paint", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("repaints the field with box-shadow, the only property autofill honours", () => {
    const source = rules.join("\n");
    expect(source).toMatch(/-webkit-box-shadow|box-shadow/);
    expect(source).toMatch(/-webkit-text-fill-color/);
  });

  it("takes its colours from tokens so the theme still applies", () => {
    const source = rules.join("\n");
    expect(source).toMatch(/var\(--/);
    // A hex here is a colour that cannot follow the theme.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("restates the paint for dark mode, which resolves different tokens", () => {
    expect(css).toMatch(/\.dark[^{]*-webkit-autofill|-webkit-autofill[^{]*\.dark/);
  });
});
