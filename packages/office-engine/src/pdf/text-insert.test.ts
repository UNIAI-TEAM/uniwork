// Inserting new text objects: placement, stacked lines, page rotation axes, skips.
// Every run uses the bundled Noto Sans ("noto") so no system font is needed.
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyTextInserts } from "./text-insert.ts";
import { loadPdfium, withDocument } from "./pdfium.ts";
import { collectTextObjects } from "./text-match.ts";
import type { PageTextObj } from "./text-match.ts";
import { readPdfText } from "./extract.ts";
import type { TextInsertInput } from "./types.ts";

async function blank(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 300]);
  return doc.save();
}

const ins = (over: Partial<TextInsertInput>): TextInsertInput => ({
  pageIndex: 0,
  origin: [50, 200],
  text: "Hello",
  fontSize: 14,
  color: [10, 20, 30],
  font: "noto",
  ...over,
});

async function objectsOf(bytes: Uint8Array, pageIndex = 0): Promise<PageTextObj[]> {
  const m = await loadPdfium();
  return withDocument(m, bytes, async (doc) => {
    const page = m._FPDF_LoadPage(doc, pageIndex);
    const tp = m._FPDFText_LoadPage(page);
    try {
      return collectTextObjects(m, page, tp).map((o) => ({ ...o }));
    } finally {
      m._FPDFText_ClosePage(tp);
      m._FPDF_ClosePage(page);
    }
  });
}

const trimmed = (objs: PageTextObj[]) => objs.map((o) => ({ ...o, text: o.text.trim() }));

describe("applyTextInserts", () => {
  it("adds a searchable run at the baseline origin", async () => {
    const res = await applyTextInserts(await blank(), [ins({})]);
    expect(res.skipped).toEqual([]);
    const [o] = await objectsOf(res.bytes);
    expect(o!.text.trim()).toBe("Hello");
    expect(o!.bounds[0]).toBeGreaterThanOrEqual(49);
    expect(o!.bounds[0]).toBeLessThan(55);
    expect(o!.bounds[1]).toBeLessThan(200);
    expect(o!.bounds[3]).toBeGreaterThan(200);
    expect((await readPdfText(res.bytes)).pages[0]!.text).toContain("Hello");
  });

  it("writes Vietnamese diacritics through the bundled face", async () => {
    const text = "Tiếng Việt: đầy đủ dấu, ắ ề ỗ ự";
    const res = await applyTextInserts(await blank(), [ins({ text })]);
    expect(res.skipped).toEqual([]);
    expect((await readPdfText(res.bytes)).pages[0]!.text).toContain(text);
  });

  it("stacks '\\n' lines one leading apart and honours per-line x offsets", async () => {
    const res = await applyTextInserts(await blank(), [
      ins({ text: "one\n\nthree", lineLeading: 20, lineXOffsets: [0, 0, 30] }),
    ]);
    expect(res.skipped).toEqual([]);
    const objs = trimmed(await objectsOf(res.bytes));
    const one = objs.find((o) => o.text === "one")!;
    const three = objs.find((o) => o.text === "three")!;
    expect(objs).toHaveLength(2); // the blank line draws nothing
    // two leadings down, shifted right by the offset
    expect(one.bounds[1] - three.bounds[1]).toBeGreaterThan(35);
    expect(three.bounds[0] - one.bounds[0]).toBeGreaterThan(25);
  });

  it("defaults the leading to 1.2 × the font size", async () => {
    const res = await applyTextInserts(await blank(), [ins({ text: "aaa\nbbb", fontSize: 20 })]);
    const objs = trimmed(await objectsOf(res.bytes));
    const a = objs.find((o) => o.text === "aaa")!;
    const b = objs.find((o) => o.text === "bbb")!;
    expect(a.bounds[1] - b.bounds[1]).toBeCloseTo(24, 0);
  });

  it.each([
    [90, "tall"],
    [270, "tall"],
    [180, "wide"],
    [0, "wide"],
    [-90, "tall"],
    [450, "tall"],
  ])("keeps glyphs upright for a page rotated %i degrees (%s ink box)", async (rotate, shape) => {
    const res = await applyTextInserts(await blank(), [
      ins({ text: "Rotated text", origin: [200, 150], rotate }),
    ]);
    expect(res.skipped).toEqual([]);
    const [o] = await objectsOf(res.bytes);
    const w = o!.bounds[2] - o!.bounds[0];
    const h = o!.bounds[3] - o!.bounds[1];
    if (shape === "tall") expect(h).toBeGreaterThan(w);
    else expect(w).toBeGreaterThan(h);
  });

  it("inserts on several pages and keeps request order for the skip indexes", async () => {
    const res = await applyTextInserts(await blank(2), [
      ins({ pageIndex: 1, text: "second page" }),
      ins({ pageIndex: 5, text: "nowhere" }),
      ins({ pageIndex: 0, text: "first page" }),
      ins({ pageIndex: -1, text: "negative" }),
    ]);
    expect(res.skipped).toEqual([
      { editIndex: 1, pageIndex: 5, reason: "page does not exist" },
      { editIndex: 3, pageIndex: -1, reason: "page does not exist" },
    ]);
    const text = await readPdfText(res.bytes);
    expect(text.pages[0]!.text).toContain("first page");
    expect(text.pages[1]!.text).toContain("second page");
  });

  it("skips an empty or whitespace-only insert without touching the document", async () => {
    const input = await blank();
    const res = await applyTextInserts(input, [ins({ text: "" }), ins({ text: " \n " })]);
    expect(res.bytes).toBe(input);
    expect(res.skipped).toEqual([
      { editIndex: 0, pageIndex: 0, reason: "empty inserted text" },
      { editIndex: 1, pageIndex: 0, reason: "empty inserted text" },
    ]);
  });

  it("skips only the insert no face can draw and still saves the others", async () => {
    // U+10FFFE is a noncharacter: no font maps it
    const res = await applyTextInserts(await blank(), [
      ins({ text: "bad \u{10fffe}" }),
      ins({ text: "fine", origin: [50, 100] }),
    ]);
    expect(res.skipped).toEqual([
      {
        editIndex: 0,
        pageIndex: 0,
        reason: "the replacement contains characters no available font can draw",
      },
    ]);
    expect((await readPdfText(res.bytes)).pages[0]!.text).toContain("fine");
  });

  it("returns the input bytes for an empty request", async () => {
    const input = await blank();
    expect(await applyTextInserts(input, [])).toEqual({ bytes: input, skipped: [] });
  });

  it("uses the bold face of the chosen font when bold is asked", async () => {
    const plain = await applyTextInserts(await blank(), [ins({ text: "Weighty" })]);
    const bold = await applyTextInserts(await blank(), [ins({ text: "Weighty", bold: true })]);
    const [p] = await objectsOf(plain.bytes);
    const [b] = await objectsOf(bold.bytes);
    // the bold face is wider than the regular one for the same text
    expect(b!.bounds[2] - b!.bounds[0]).toBeGreaterThan(p!.bounds[2] - p!.bounds[0]);
  });

  it("accepts italic and bold-italic requests on a font without an italic face", async () => {
    const res = await applyTextInserts(await blank(), [
      ins({ text: "Slanted", italic: true }),
      ins({ text: "Both", bold: true, italic: true, origin: [50, 100] }),
    ]);
    expect(res.skipped).toEqual([]);
    const text = (await readPdfText(res.bytes)).pages[0]!.text;
    expect(text).toContain("Slanted");
    expect(text).toContain("Both");
  });
});
