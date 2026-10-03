// B4 — page operations. Engine-first: insert blank page / insert pages from
// another PDF (in-place, page-tree only) and extract / merge / split (NEW
// documents for the host to commit, F2). Every case proves untouched pages keep
// their content streams and annotations, per-op skips are reported honestly,
// and a second save accumulates on the first (F1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyPdfEditBytes, PdfTypedError } from "./adapter";
import { readPdfText } from "./extract";

const FIXTURES = fileURLToPath(
  new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url),
);
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));
const TEXT_PDF = () => fixture("pdf-text-editable.pdf");
const IMAGE_PDF = () => fixture("pdf-image.pdf");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

type Op = { op: string; attributes: Record<string, unknown> };

describe("pdf page ops — insert blank page", () => {
  it("inserts a blank page that copies the neighbor's size and rotation", async () => {
    const input = TEXT_PDF();
    const before = await readPdfText(input);
    const out = await applyPdfEditBytes(input, [
      { op: "insertBlankPage", attributes: { afterPageIndex: 0 } } satisfies Op,
    ]);
    expect(out.report.blankPages).toEqual({ applied: 1, skipped: 0 });
    expect(out.report.pageOps.deletions).toBe(0);
    expect(await pageCount(out.bytes)).toBe(before.pageCount + 1);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(1).getWidth()).toBeCloseTo(doc.getPage(0).getWidth(), 2);
    expect(doc.getPage(1).getHeight()).toBeCloseTo(doc.getPage(0).getHeight(), 2);
    // Untouched pages keep their content streams.
    const after = await readPdfText(out.bytes);
    expect(after.pages[0]!.text).toBe(before.pages[0]!.text);
    expect(after.pages[2]!.text).toBe(before.pages[1]!.text);
  });

  it("accepts an explicit size and inserts at the front", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "insertBlankPage", attributes: { afterPageIndex: -1, width: 200, height: 300 } } satisfies Op,
    ]);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(200, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(300, 2);
  });

  it("places an inserted PDF before an equally anchored blank page", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "insertBlankPage", attributes: { afterPageIndex: 0, width: 300, height: 400 } } satisfies Op,
      { op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: b64(TEXT_PDF()) } } satisfies Op,
    ]);
    expect(out.report.blankPages).toEqual({ applied: 1, skipped: 0 });
    expect(out.report.insertedPdfs).toEqual({ applied: 1, skipped: 0 });
    expect(await pageCount(out.bytes)).toBe(5);
    const doc = await PDFDocument.load(out.bytes);
    // order: page 0, inserted pages 1-2, blank page 3 (300x400), original page 4
    expect(doc.getPage(1).getWidth()).toBeCloseTo(doc.getPage(0).getWidth(), 2);
    expect(doc.getPage(3).getWidth()).toBeCloseTo(300, 2);
  });

  it("skips an insert whose anchor page is out of range, with a warning", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "insertBlankPage", attributes: { afterPageIndex: 99 } } satisfies Op,
    ]);
    expect(out.report.blankPages).toEqual({ applied: 0, skipped: 1 });
    expect(out.warnings.some((w) => w.code === "edit_skipped" && w.detail?.includes("insertBlankPage"))).toBe(true);
    expect(await pageCount(out.bytes)).toBe(2);
  });
});

describe("pdf page ops — insert pages from another PDF", () => {
  it("inserts the source's pages at the requested index", async () => {
    const out = await applyPdfEditBytes(IMAGE_PDF(), [
      { op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: b64(TEXT_PDF()) } } satisfies Op,
    ]);
    expect(out.report.insertedPdfs).toEqual({ applied: 1, skipped: 0 });
    expect(await pageCount(out.bytes)).toBe(3);
    const text = await readPdfText(out.bytes);
    expect(text.pages[1]!.text).toContain("Bao cao tong hop nam 2026");
    expect(text.pages[2]!.text).toContain("Bao cao tong hop nam 2026");
  });

  it("honors a source page subset", async () => {
    const subset = await applyPdfEditBytes(IMAGE_PDF(), [
      { op: "insertPdfPages", attributes: { afterPageIndex: -1, pdf: b64(TEXT_PDF()), pages: [1] } } satisfies Op,
    ]);
    expect(subset.report.insertedPdfs).toEqual({ applied: 1, skipped: 0 });
    expect(await pageCount(subset.bytes)).toBe(2);
  });

  it("refuses an unusable source PDF as a typed error, not a silent skip", async () => {
    const bad64 = await applyPdfEditBytes(IMAGE_PDF(), [
      { op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: "!!!!" } } satisfies Op,
    ]).catch((reason: unknown) => reason);
    expect((bad64 as PdfTypedError).reason).toContain("bad_op:insertPdfPages");

    const notPdf = await applyPdfEditBytes(IMAGE_PDF(), [
      { op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: b64(new Uint8Array([1, 2, 3, 4])) } } satisfies Op,
    ]).catch((reason: unknown) => reason);
    expect((notPdf as PdfTypedError).reason).toContain("bad_op:insertPdfPages");
  });
});

describe("pdf page ops — documents for a Documents commit (F2)", () => {
  it("extracts selected pages into a new one-page document", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "extractPages", attributes: { pages: [1], name: "trich-xuat" } } satisfies Op,
    ]);
    expect(out.report.newDocuments).toEqual({ extracted: 1, merged: 0, splitParts: 0, skipped: 0 });
    expect(out.documents).toHaveLength(1);
    const doc = out.documents[0]!;
    expect(doc).toMatchObject({ op: "extractPages", name: "trich-xuat", pageCount: 1 });
    expect(doc.dataBase64).not.toBe("");
    expect(await pageCount(Uint8Array.from(Buffer.from(doc.dataBase64, "base64")))).toBe(1);
  });

  it("skips an extraction with no valid page instead of emitting an empty document", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "extractPages", attributes: { pages: [99] } } satisfies Op,
    ]);
    expect(out.documents).toHaveLength(0);
    expect(out.report.newDocuments.skipped).toBe(1);
    expect(out.warnings.some((w) => w.detail?.includes("extractPages"))).toBe(true);
  });

  it("merges other PDFs into a new document", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "mergePdfs", attributes: { pdfs: [b64(IMAGE_PDF())], name: "gop" } } satisfies Op,
    ]);
    expect(out.report.newDocuments.merged).toBe(1);
    const doc = out.documents[0]!;
    expect(doc).toMatchObject({ op: "mergePdfs", name: "gop", pageCount: 3 });
  });

  it("splits into one document per chunk with part ordinals", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "splitPdf", attributes: { chunkSize: 1, name: "tach" } } satisfies Op,
    ]);
    expect(out.report.newDocuments.splitParts).toBe(2);
    expect(out.documents.map((doc) => doc.name)).toEqual(["tach-1", "tach-2"]);
    expect(out.documents.map((doc) => doc.part)).toEqual([1, 2]);
    expect(out.documents.every((doc) => doc.pageCount === 1)).toBe(true);
  });

  it("leaves the working bytes unchanged while producing documents", async () => {
    const input = TEXT_PDF();
    const out = await applyPdfEditBytes(input, [
      { op: "splitPdf", attributes: { chunkSize: 1 } } satisfies Op,
    ]);
    expect(await pageCount(out.bytes)).toBe(2);
  });
});

describe("pdf page ops — typed parse errors", () => {
  it.each([
    [{ op: "insertBlankPage", attributes: { afterPageIndex: "0" } }, "afterPageIndex"],
    [{ op: "insertBlankPage", attributes: { afterPageIndex: 0, width: 10 } }, "size"],
    [{ op: "insertBlankPage", attributes: { afterPageIndex: 0, width: 0, height: 10 } }, "width"],
    [{ op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: 5 } }, "pdf"],
    [{ op: "extractPages", attributes: { pages: [] } }, "pages"],
    [{ op: "extractPages", attributes: { pages: "1" } }, "pages"],
    [{ op: "mergePdfs", attributes: { pdfs: [] } }, "pdfs"],
    [{ op: "splitPdf", attributes: { chunkSize: 1.5 } }, "chunkSize"],
    [{ op: "splitPdf", attributes: { chunkSize: 0 } }, "chunkSize"],
    [{ op: "splitPdf", attributes: {} }, "chunkSize"],
  ] as [Op, string][])("rejects malformed %j with a typed bad_op", async (op, field) => {
    const error = await applyPdfEditBytes(TEXT_PDF(), [op]).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PdfTypedError);
    expect((error as PdfTypedError).reason).toContain(`bad_op:${op.op}.${field}`);
  });

  it("rejects a repeated page-structure op instead of merging it", async () => {
    for (const op of ["insertBlankPage", "insertPdfPages", "extractPages", "mergePdfs", "splitPdf"] as const) {
      const attributes =
        op === "insertBlankPage" ? { afterPageIndex: 0 }
        : op === "insertPdfPages" ? { afterPageIndex: 0, pdf: b64(TEXT_PDF()) }
        : op === "extractPages" ? { pages: [0] }
        : op === "mergePdfs" ? { pdfs: [b64(TEXT_PDF())] }
        : { chunkSize: 1 };
      const error = await applyPdfEditBytes(TEXT_PDF(), [
        { op, attributes } satisfies Op,
        { op, attributes } satisfies Op,
      ]).catch((reason: unknown) => reason);
      expect((error as PdfTypedError).reason).toContain(`at most one ${op}`);
    }
  });

  it("rejects a negative anchor, non-numeric sizes, bad page entries and blank names", async () => {
    const rejects = async (op: Op) => {
      const error = await applyPdfEditBytes(TEXT_PDF(), [op]).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(PdfTypedError);
      return error as PdfTypedError;
    };
    expect((await rejects({ op: "insertBlankPage", attributes: { afterPageIndex: -2 } })).reason).toContain("afterPageIndex");
    expect((await rejects({ op: "insertBlankPage", attributes: { afterPageIndex: 0, width: "10", height: 10 } })).reason).toContain("width");
    expect((await rejects({ op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: b64(TEXT_PDF()), pages: [] } })).reason).toContain("pages");
    expect((await rejects({ op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: b64(TEXT_PDF()), pages: [0.5] } })).reason).toContain("pages");
    expect((await rejects({ op: "mergePdfs", attributes: { pdfs: [7] } })).reason).toContain("pdfs[0]");
    expect((await rejects({ op: "extractPages", attributes: { pages: [0], name: "   " } })).reason).toContain("name");
    expect((await rejects({ op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: "   " } })).reason).toContain("base64");
  });

  it("treats a blank optional name as absent rather than an error", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "splitPdf", attributes: { chunkSize: 1, name: "  " } } satisfies Op,
    ]);
    expect(out.documents.map((doc) => doc.name)).toEqual(["split-1", "split-2"]);
  });
});

describe("pdf page ops — accumulation and annotation safety (F1)", () => {
  it("accumulates a page insert and an annotation across two saves", async () => {
    const first = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "insertBlankPage", attributes: { afterPageIndex: 1, width: 300, height: 400 } } satisfies Op,
    ]);
    expect(await pageCount(first.bytes)).toBe(3);

    const second = await applyPdfEditBytes(first.bytes, [
      { op: "addMarkup", attributes: { markup: { pageIndex: 0, type: "highlight", color: [1, 0.8, 0], quads: [[10, 700, 80, 700, 10, 688, 80, 688]] } } } satisfies Op,
      { op: "extractPages", attributes: { pages: [0, 1] } } satisfies Op,
    ]);
    expect(second.report.markups).toEqual({ applied: 1, skipped: 0 });
    expect(await pageCount(second.bytes)).toBe(3);
    expect(second.documents[0]!.pageCount).toBe(2);

    // Fresh reopen proves both saves survive: the blank page and the markup.
    const doc = await PDFDocument.load(second.bytes);
    expect(doc.getPage(2).getWidth()).toBeCloseTo(300, 2);
    const annots = doc.context.lookup(doc.getPage(0)!.node.get(PDFName.of("Annots"))!, PDFArray);
    const subtypes: string[] = [];
    for (let i = 0; i < annots.size(); i++) {
      subtypes.push(annots.lookup(i, PDFDict).lookup(PDFName.of("Subtype"))?.toString() ?? "");
    }
    expect(subtypes).toContain("/Highlight");
    // Annotation-only: the page's content stream is byte-identical to the input.
    const text = await readPdfText(second.bytes);
    expect(text.pages[0]!.text).toBe((await readPdfText(TEXT_PDF())).pages[0]!.text);
  });
});
