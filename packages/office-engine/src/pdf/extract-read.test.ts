// readPdfText: page span clamping, char budget truncation, info dictionary and
// scanned/blank pages, on real fixtures.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readPdfText } from "./extract";

const FIXTURES = fileURLToPath(new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));

describe("readPdfText", () => {
  it("reads every page, the page sizes and the info entries", async () => {
    const doc = await readPdfText(fixture("pdf-text-editable.pdf"));
    expect(doc.pageCount).toBe(2);
    expect(doc.truncated).toBe(false);
    expect(doc.info).toEqual({ title: "Báo cáo tổng hợp năm 2026", author: "UniWork Office G0" });
    expect(doc.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(doc.pages[0]!.widthPt).toBeCloseTo(595.28, 1);
    expect(doc.pages[0]!.heightPt).toBeCloseTo(841.89, 1);
    expect(doc.pages[0]!.hasTextLayer).toBe(true);
    expect(doc.pages[0]!.text).toContain("Bao cao tong hop nam 2026\n");
    expect(doc.pages[0]!.text).not.toContain("\r");
    expect(doc.pages[0]!.chars).toBeGreaterThan(100);
  });

  it("limits the read to the requested 1-based span", async () => {
    const second = await readPdfText(fixture("pdf-text-editable.pdf"), { fromPage: 2, toPage: 2 });
    expect(second.pages.map((p) => p.page)).toEqual([2]);
    expect(second.pageCount).toBe(2);
  });

  it("clamps an out-of-range span into the document", async () => {
    const past = await readPdfText(fixture("pdf-text-editable.pdf"), { fromPage: 50, toPage: 99 });
    expect(past.pages.map((p) => p.page)).toEqual([2]);
    const before = await readPdfText(fixture("pdf-text-editable.pdf"), { fromPage: -4, toPage: 1 });
    expect(before.pages.map((p) => p.page)).toEqual([1]);
    const inverted = await readPdfText(fixture("pdf-text-editable.pdf"), { fromPage: 2, toPage: 1 });
    expect(inverted.pages.map((p) => p.page)).toEqual([2]);
  });

  it("stops at the char budget, cuts the text there and flags truncation", async () => {
    const doc = await readPdfText(fixture("pdf-text-editable.pdf"), { charBudget: 20 });
    expect(doc.truncated).toBe(true);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]!.text).toHaveLength(20);
    expect(doc.pages[0]!.text.startsWith("Bao cao tong hop")).toBe(true);
    // chars still reports the page's real size, so callers can tell text was cut.
    expect(doc.pages[0]!.chars).toBeGreaterThan(20);
  });

  it("does not flag truncation when the budget exactly fits", async () => {
    const full = await readPdfText(fixture("pdf-table.pdf"));
    const len = full.pages[0]!.text.length;
    const exact = await readPdfText(fixture("pdf-table.pdf"), { charBudget: len });
    expect(exact.truncated).toBe(false);
    expect(exact.pages[0]!.text).toBe(full.pages[0]!.text);
  });

  it("reports a page without a text layer as empty", async () => {
    const doc = await readPdfText(fixture("pdf-scanned-page.pdf"));
    expect(doc.pages[0]).toMatchObject({ chars: 0, text: "", hasTextLayer: false });
  });

  it("omits info entries the document does not carry", async () => {
    const doc = await readPdfText(fixture("pdf-acroform.pdf"));
    expect(doc.info).toEqual({});
  });
});
