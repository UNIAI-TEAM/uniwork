import { describe, expect, it } from "vitest";
import { escapeSelectiveMarkdownText } from "./escape";

/**
 * The selective escaper is what lets an untouched paragraph reopen byte-equal.
 * These cases pin both halves of the rule: text with no live delimiter pair is
 * left exactly as written, and text that WOULD be reinterpreted is escaped.
 */
describe("escapeSelectiveMarkdownText", () => {
  it("leaves ordinary text untouched", () => {
    for (const text of [
      "plain sentence",
      "snake_case_name and other_identifiers",
      "2 * 3 = 6",
      "cost is 50% off",
      "a ~tilde~ inside",
      "Footnote reference[^1] here.",
      "[^1]: The footnote body stays literal.",
      "C# and F# are languages",
      "a | b | c",
    ]) {
      expect(escapeSelectiveMarkdownText(text)).toBe(text);
    }
  });

  it("escapes a backslash and a backtick unconditionally", () => {
    expect(escapeSelectiveMarkdownText("back\\slash")).toBe("back\\\\slash");
    expect(escapeSelectiveMarkdownText("a `tick` b")).toBe("a \\`tick\\` b");
  });

  it("escapes emphasis delimiters when a live pair is present", () => {
    expect(escapeSelectiveMarkdownText("2 * 3 and *4*")).toBe("2 \\* 3 and \\*4\\*");
    expect(escapeSelectiveMarkdownText("a _x_ b")).toBe("a \\_x\\_ b");
    expect(escapeSelectiveMarkdownText("a ~~gone~~ b")).toBe("a \\~\\~gone\\~\\~ b");
  });

  it("escapes a bracket only when it opens a link or image label", () => {
    expect(escapeSelectiveMarkdownText("see [docs](https://x) now")).toBe("see \\[docs](https://x) now");
    expect(escapeSelectiveMarkdownText("see [docs] now")).toBe("see [docs] now");
  });

  it("never escapes intraword underscores (CommonMark forbids them)", () => {
    expect(escapeSelectiveMarkdownText("foo_bar_baz")).toBe("foo_bar_baz");
    expect(escapeSelectiveMarkdownText("a _b_ c")).toBe("a \\_b\\_ c");
  });

  it("escapes every escapable character past the scan bound (no quadratic probe)", () => {
    const long = "a_b".repeat(6000);
    const out = escapeSelectiveMarkdownText(long);
    expect(out).toContain("\\_");
    expect(out.length).toBeGreaterThan(long.length);
  });
});
