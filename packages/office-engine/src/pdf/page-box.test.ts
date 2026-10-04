// B7 — page box + N-up. Engine-first: MediaBox / CropBox writes round-trip
// through save → fresh reopen, N-up imposes pages onto rows×cols sheets with
// the expected sheet count and cell layout, malformed input is a typed refusal
// (never a silent drop), and a second save accumulates on the first (F1).
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyPdfEditBytes, PdfTypedError } from "./adapter";
import { setNUp, setPageBox } from "./page-box";
import { PdfOpError } from "./op-parse";

type Op = { op: string; attributes: Record<string, unknown> };

/** A three-page document with distinct, known page sizes. */
async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  doc.addPage([200, 500]);
  doc.addPage([400, 300]);
  return doc.save({ useObjectStreams: false });
}

/** Decoded bytes of one content stream, inflating pdf-lib's FlateDecode. */
function decodeStream(stream: PDFStream): string {
  const raw = Buffer.from(stream.getContents());
  const filter = stream.dict.get(PDFName.of("Filter"))?.toString() ?? "";
  return (filter.includes("FlateDecode") ? inflateSync(raw) : raw).toString("latin1");
}

/** A page's content stream(s) as text, whether saved as one stream or an array. */
function pageContent(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.get(PDFName.of("Contents"));
  if (!contents) return "";
  const resolved = doc.context.lookup(contents);
  if (resolved instanceof PDFArray) {
    return resolved
      .asArray()
      .map((ref) => decodeStream(doc.context.lookup(ref, PDFStream)))
      .join("\n");
  }
  return decodeStream(doc.context.lookup(contents, PDFStream));
}

/** Every non-identity scale factor (`sx 0 0 sy 0 0 cm` with sx === sy) in a
    page's content, i.e. the per-cell placement scales. */
function cellScales(doc: PDFDocument, pageIndex: number): number[] {
  const scales: number[] = [];
  for (const m of pageContent(doc, pageIndex).matchAll(/([\d.]+) 0 0 ([\d.]+) 0 0 cm/g)) {
    const sx = Number(m[1]);
    const sy = Number(m[2]);
    if (sx === sy && sx !== 1) scales.push(sx);
  }
  return scales;
}

/** How many embedded-page Form XObjects a sheet draws (one per placed cell). */
function placedCount(doc: PDFDocument, pageIndex: number): number {
  return (pageContent(doc, pageIndex).match(/ Do\b/g) ?? []).length;
}

/** The XObject names a page's resources declare. */
function xobjectNames(doc: PDFDocument, pageIndex: number): string[] {
  const resources = doc.getPage(pageIndex).node.get(PDFName.of("Resources"));
  if (!resources) return [];
  const xobjects = doc.context.lookup(resources, PDFDict).get(PDFName.of("XObject"));
  if (!xobjects) return [];
  return doc.context.lookup(xobjects, PDFDict).keys();
}

describe("pdf page box — media and crop round-trip", () => {
  it("sets a MediaBox that survives save and reopen", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setPageBox", attributes: { pages: [0], box: "media", rect: [0, 0, 300, 400] } } satisfies Op,
    ]);
    expect(out.report.pageBoxes).toEqual({ applied: 1, skipped: 0 });
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 300, height: 400 });
    // Untouched pages keep their own boxes.
    expect(doc.getPage(1).getMediaBox()).toEqual({ x: 0, y: 0, width: 200, height: 500 });
  });

  it("sets a CropBox with a non-zero origin that survives save and reopen", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setPageBox", attributes: { pages: [1], box: "crop", rect: [10, 20, 150, 250] } } satisfies Op,
    ]);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(1).getCropBox()).toEqual({ x: 10, y: 20, width: 140, height: 230 });
    // CropBox does not move the MediaBox.
    expect(doc.getPage(1).getMediaBox()).toEqual({ x: 0, y: 0, width: 200, height: 500 });
  });

  it("applies one box write to every requested page", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setPageBox", attributes: { pages: [0, 2], box: "media", rect: [0, 0, 612, 792] } } satisfies Op,
    ]);
    expect(out.report.pageBoxes).toEqual({ applied: 2, skipped: 0 });
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(0).getMediaBox().width).toBeCloseTo(612, 2);
    expect(doc.getPage(2).getMediaBox().height).toBeCloseTo(792, 2);
  });
});

describe("pdf page box — N-up imposition", () => {
  it("imposes pages onto A4 sheets with the expected sheet count", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setNUp", attributes: { pages: [0, 1, 2], layout: { rows: 2, cols: 2 }, paper: "a4" } } satisfies Op,
    ]);
    expect(out.report.nUp).toEqual({ applied: 1, skipped: 0 });
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 2);
    // Three source pages placed into the 2x2 grid → three drawn cells.
    expect(placedCount(doc, 0)).toBe(3);
    expect(xobjectNames(doc, 0)).toHaveLength(3);
  });

  it("spills onto a second sheet when the grid fills up", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setNUp", attributes: { pages: [0, 1, 2, 0, 1], layout: { rows: 1, cols: 2 }, paper: "letter" } } satisfies Op,
    ]);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(3); // 5 pages / 2 per sheet
    expect(doc.getPage(0).getWidth()).toBeCloseTo(612, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(792, 2);
    expect(placedCount(doc, 0)).toBe(2);
    expect(placedCount(doc, 1)).toBe(2);
    expect(placedCount(doc, 2)).toBe(1);
  });

  it("keeps the first source page's size when no paper is given", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setNUp", attributes: { pages: [1, 2], layout: { rows: 2, cols: 1 } } } satisfies Op,
    ]);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    // Sheet takes page 1's own size (200x500), not A4.
    expect(doc.getPage(0).getWidth()).toBeCloseTo(200, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(500, 2);
    expect(placedCount(doc, 0)).toBe(2);
  });

  it("scales a landscape page down to fit its cell", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setNUp", attributes: { pages: [2, 0], layout: { rows: 1, cols: 2 }, paper: "a4" } } satisfies Op,
    ]);
    const doc = await PDFDocument.load(out.bytes);
    // Two placement scales, each below 1: a 400pt-wide page and a 595.28pt-wide
    // page both shrink into a 297.64pt-wide A4 half-sheet cell.
    const scales = cellScales(doc, 0);
    expect(scales).toHaveLength(2);
    for (const scale of scales) {
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThan(1);
    }
  });
});

describe("pdf page box — typed refusals", () => {
  it("throws a typed PdfOpError from setPageBox for an out-of-range index", async () => {
    const doc = await PDFDocument.load(await fixture());
    expect(() => setPageBox(doc, { pages: [9], box: "media", rect: [0, 0, 100, 100] })).toThrow(PdfOpError);
    expect(() => setPageBox(doc, { pages: [0.5], box: "media", rect: [0, 0, 100, 100] })).toThrow(PdfOpError);
    expect(() => setPageBox(doc, { pages: [], box: "media", rect: [0, 0, 100, 100] })).toThrow(PdfOpError);
  });

  it("throws a typed PdfOpError from setNUp for a bad layout or out-of-range page", async () => {
    const doc = await PDFDocument.load(await fixture());
    await expect(setNUp(doc, { pages: [0], layout: { rows: 0, cols: 2 } })).rejects.toThrow(PdfOpError);
    await expect(setNUp(doc, { pages: [0], layout: { rows: 1, cols: 0 } })).rejects.toThrow(PdfOpError);
    await expect(setNUp(doc, { pages: [7], layout: { rows: 1, cols: 2 } })).rejects.toThrow(PdfOpError);
  });

  it("reports an out-of-range page as a per-op skip, never a silent drop", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setPageBox", attributes: { pages: [9], box: "media", rect: [0, 0, 100, 100] } } satisfies Op,
    ]);
    expect(out.report.pageBoxes).toEqual({ applied: 0, skipped: 1 });
    expect(out.warnings.some((w) => w.code === "edit_skipped" && w.detail?.includes("setPageBox"))).toBe(true);
    // The refused write changed nothing.
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 300, height: 400 });
  });

  it("reports an out-of-range N-up page as a per-op skip with a warning", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      { op: "setNUp", attributes: { pages: [7], layout: { rows: 1, cols: 2 } } } satisfies Op,
    ]);
    expect(out.report.nUp).toEqual({ applied: 0, skipped: 1 });
    expect(out.warnings.some((w) => w.code === "edit_skipped" && w.detail?.includes("setNUp"))).toBe(true);
  });

  it("refuses a degenerate or inverted rect", async () => {
    const rejects = async (rect: number[]) => {
      const error = await applyPdfEditBytes(await fixture(), [
        { op: "setPageBox", attributes: { pages: [0], box: "crop", rect } } satisfies Op,
      ]).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(PdfTypedError);
      return error as PdfTypedError;
    };
    expect((await rejects([0, 0, 0, 100])).reason).toContain("rect");
    expect((await rejects([0, 0, 100, 0])).reason).toContain("rect");
    expect((await rejects([100, 0, 0, 100])).reason).toContain("rect");
  });

  it("refuses an unknown box, an empty page list and a non-integer page", async () => {
    const rejects = async (attributes: Record<string, unknown>) => {
      const error = await applyPdfEditBytes(await fixture(), [
        { op: "setPageBox", attributes } satisfies Op,
      ]).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(PdfTypedError);
      return error as PdfTypedError;
    };
    expect((await rejects({ pages: [0], box: "bleed", rect: [0, 0, 10, 10] })).reason).toContain("box");
    expect((await rejects({ pages: [], box: "media", rect: [0, 0, 10, 10] })).reason).toContain("pages");
    expect((await rejects({ pages: [0.5], box: "media", rect: [0, 0, 10, 10] })).reason).toContain("pages");
  });

  it("refuses an N-up layout with a zero row or column count", async () => {
    const rejects = async (layout: Record<string, unknown>) => {
      const error = await applyPdfEditBytes(await fixture(), [
        { op: "setNUp", attributes: { pages: [0], layout } } satisfies Op,
      ]).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(PdfTypedError);
      return error as PdfTypedError;
    };
    expect((await rejects({ rows: 0, cols: 2 })).reason).toContain("rows");
    expect((await rejects({ rows: 2, cols: 0 })).reason).toContain("cols");
  });

  it("refuses a second N-up in one request", async () => {
    const twice = await applyPdfEditBytes(await fixture(), [
      { op: "setNUp", attributes: { pages: [0], layout: { rows: 1, cols: 2 } } } satisfies Op,
      { op: "setNUp", attributes: { pages: [1], layout: { rows: 1, cols: 2 } } } satisfies Op,
    ]).catch((reason: unknown) => reason);
    expect(twice).toBeInstanceOf(PdfTypedError);
    expect((twice as PdfTypedError).reason).toContain("at most one setNUp");
  });
});

describe("pdf page box — accumulation across two saves (F1)", () => {
  it("keeps a first-save MediaBox and a second-save CropBox together", async () => {
    const first = await applyPdfEditBytes(await fixture(), [
      { op: "setPageBox", attributes: { pages: [0], box: "media", rect: [0, 0, 350, 450] } } satisfies Op,
    ]);
    const second = await applyPdfEditBytes(first.bytes, [
      { op: "setPageBox", attributes: { pages: [2], box: "crop", rect: [5, 5, 205, 305] } } satisfies Op,
    ]);
    expect(second.report.pageBoxes).toEqual({ applied: 1, skipped: 0 });
    const doc = await PDFDocument.load(second.bytes);
    // Both writes survive a fresh reopen: the first save's media box and the
    // second save's crop box.
    expect(doc.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 350, height: 450 });
    expect(doc.getPage(2).getCropBox()).toEqual({ x: 5, y: 5, width: 200, height: 300 });
  });

  it("accumulates an N-up imposition and a later box write", async () => {
    const first = await applyPdfEditBytes(await fixture(), [
      { op: "setNUp", attributes: { pages: [0, 1], layout: { rows: 1, cols: 2 }, paper: "a4" } } satisfies Op,
    ]);
    const second = await applyPdfEditBytes(first.bytes, [
      { op: "setPageBox", attributes: { pages: [0], box: "crop", rect: [0, 0, 400, 600] } } satisfies Op,
    ]);
    const doc = await PDFDocument.load(second.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 400, height: 600 });
    expect(placedCount(doc, 0)).toBe(2);
  });
});
