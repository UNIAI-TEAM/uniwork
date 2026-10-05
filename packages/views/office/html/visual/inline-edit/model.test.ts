import { describe, expect, it } from "vitest";
// Imported through the barrel: this is what keeps the package's public
// surface (index.ts) reachable, so knip does not read it as dead code.
import { clampResizeValue, INLINE_MAX_TEXT, parseTextEditCommit, type InlineTextCommit } from "./index";

const WELL_FORMED: InlineTextCommit = { sid: 7, text: "Chào" };

describe("parseTextEditCommit (untrusted frame payload)", () => {
  it("accepts a well-formed commit", () => {
    expect(parseTextEditCommit({ type: "text-edit-commit", ...WELL_FORMED })).toEqual(WELL_FORMED);
  });

  it("accepts empty text (an element cleared to nothing)", () => {
    expect(parseTextEditCommit({ type: "text-edit-commit", sid: 1, text: "" })).toEqual({ sid: 1, text: "" });
  });

  it("rejects everything that is not the expected shape", () => {
    const bad: unknown[] = [
      null,
      "text-edit-commit",
      [],
      { type: "select", sid: 1, text: "x" },
      { type: "text-edit-commit", text: "x" },
      { type: "text-edit-commit", sid: 0, text: "x" },
      { type: "text-edit-commit", sid: -3, text: "x" },
      { type: "text-edit-commit", sid: 1.5, text: "x" },
      { type: "text-edit-commit", sid: 2 ** 31, text: "x" },
      { type: "text-edit-commit", sid: Number.NaN, text: "x" },
      { type: "text-edit-commit", sid: "7", text: "x" },
      { type: "text-edit-commit", sid: 7 },
      { type: "text-edit-commit", sid: 7, text: 42 },
      { type: "text-edit-commit", sid: 7, text: null },
    ];
    for (const payload of bad) expect(parseTextEditCommit(payload), JSON.stringify(payload)).toBeNull();
  });

  it("clamps an over-long text instead of trusting it at any length", () => {
    const text = "a".repeat(INLINE_MAX_TEXT + 50);
    const commit = parseTextEditCommit({ type: "text-edit-commit", sid: 4, text });
    expect(commit?.text.length).toBe(INLINE_MAX_TEXT);
  });
});

describe("clampResizeValue", () => {
  it("rounds to whole pixels", () => {
    expect(clampResizeValue(12.6)).toBe(13);
    expect(clampResizeValue(12.4)).toBe(12);
  });

  it("clamps into the writable range", () => {
    expect(clampResizeValue(0)).toBe(1);
    expect(clampResizeValue(-40)).toBe(1);
    expect(clampResizeValue(1_000_000)).toBe(10_000);
  });

  it("returns null for a value that is not a size", () => {
    expect(clampResizeValue(Number.NaN)).toBeNull();
    expect(clampResizeValue(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
