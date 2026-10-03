import { describe, expect, it } from "vitest";
import type { DocxHeaderFooter } from "@uniwork/office-engine/docx";
import { PAGE_TOKEN, TOTAL_TOKEN, applyHfText, hfDraftIsEmpty, hfEditText, hfParasOf } from "./header-footer-text";

/** The vendored engine's field sentinels (docx-engine types.ts: U+E001 / U+E000). */
const PAGE_MARK = "\uE001";
const TOTAL_PAGES_MARK = "\uE000";

function parasOf(value: DocxHeaderFooter): Array<Record<string, unknown>> {
  return value.paras as Array<Record<string, unknown>>;
}

describe("hfEditText", () => {
  it("returns an empty draft for an absent part", () => {
    expect(hfEditText(null)).toBe("");
  });

  it("shows the legacy single line, with the page field as a token", () => {
    expect(hfEditText({ text: "Page", pageNumber: true })).toBe(`Page ${PAGE_TOKEN}`);
    expect(hfEditText({ text: "Confidential" })).toBe("Confidential");
  });

  it("keeps field sentinels visible as tokens and skips layout-table rows", () => {
    const value: DocxHeaderFooter = {
      text: "",
      paras: [
        { runs: [{ text: "left\tright" }] },
        { cells: [{ paras: [[{ text: "cell" }]] }], runs: [] },
        { runs: [{ text: `A${PAGE_MARK}B` }, { text: `${TOTAL_PAGES_MARK}` }] },
      ],
    };
    expect(hfEditText(value)).toBe(`left\tright\nA${PAGE_TOKEN}B${TOTAL_TOKEN}`);
  });

  it("normalizes a legacy page-number value into a paragraph", () => {
    const paras = hfParasOf({ text: "", pageNumber: true });
    expect(paras).toEqual([{ align: "center", runs: [{ text: PAGE_MARK }] }]);
  });
});

describe("applyHfText", () => {
  it("maps an edited line onto its paragraph template, keeping the run style", () => {
    const value: DocxHeaderFooter = {
      text: "Old",
      paras: [{ align: "center", runs: [{ text: "Old", bold: true }] }],
    };
    expect(applyHfText(value, "New")).toEqual({
      text: "New",
      paras: [{ align: "center", runs: [{ text: "New", bold: true }] }],
    });
  });

  it("maps tokens back to the field sentinels in text and paragraphs", () => {
    const next = applyHfText({ text: "" }, `Trang ${PAGE_TOKEN}/${TOTAL_TOKEN}`);
    expect(next.text).toBe(`Trang ${PAGE_MARK}/${TOTAL_PAGES_MARK}`);
    expect(parasOf(next)[0]?.runs).toEqual([{ text: `Trang ${PAGE_MARK}/${TOTAL_PAGES_MARK}` }]);
  });

  it("reuses the last template for extra lines and drops removed ones", () => {
    const value: DocxHeaderFooter = {
      text: "A\nB",
      paras: [
        { align: "left", runs: [{ text: "A", italic: true }] },
        { align: "right", runs: [{ text: "B", bold: true }] },
      ],
    };
    const grown = applyHfText(value, "A2\nB2\nC2");
    expect(parasOf(grown)).toHaveLength(3);
    expect(parasOf(grown)[2]).toMatchObject({ align: "right", runs: [{ text: "C2", bold: true }] });
    const shrunk = applyHfText(value, "only");
    expect(parasOf(shrunk)).toHaveLength(1);
    expect(shrunk.text).toBe("only");
  });

  it("splices layout-table rows back at their original positions", () => {
    const row = { cells: [{ paras: [[{ text: "logo text" }]] }], runs: [] };
    const value: DocxHeaderFooter = {
      text: "Old",
      paras: [row, { runs: [{ text: "Old" }] }],
    };
    const next = applyHfText(value, "New");
    expect(parasOf(next)[0]).toEqual(row);
    expect(parasOf(next)[1]).toMatchObject({ runs: [{ text: "New" }] });
    expect(next.text).toBe("New");
  });

  it("trims trailing newlines and keeps empty interior lines", () => {
    const next = applyHfText(null, "first\n\nthird\n\n");
    expect(parasOf(next)).toHaveLength(3);
    expect(parasOf(next)[1]?.runs).toEqual([]);
    expect(next.text).toBe("firstthird");
  });

  it("turns an empty draft into empty paragraphs (the UI clears through its own edit)", () => {
    const next = applyHfText({ text: "Old" }, "");
    expect(next.text).toBe("");
    expect(parasOf(next)).toEqual([{ align: "center", runs: [] }]);
  });
});

describe("hfDraftIsEmpty", () => {
  it("treats blank drafts as empty and field tokens as content", () => {
    expect(hfDraftIsEmpty("")).toBe(true);
    expect(hfDraftIsEmpty("   ")).toBe(true);
    expect(hfDraftIsEmpty(PAGE_TOKEN)).toBe(false);
    expect(hfDraftIsEmpty(`${TOTAL_TOKEN} `)).toBe(false);
    expect(hfDraftIsEmpty("Text")).toBe(false);
  });
});
