// G2-05 AC-2 replay: real fixture edit → save → reopen → independent
// extraction; render diff; Vietnamese text; mixed text/image/page ops; typed
// refusals; original bytes untouched. pdfium runs in-process here — the
// same modules the sandboxed worker bundles.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyPdfEditBytes, probePdf, PdfTypedError } from "./adapter";
import { decodeImageToBgra, encodeBgraToPng } from "./codec";
import { renderPageRegionPng } from "./render";
import { readPdfText } from "./extract";

const FIXTURES = fileURLToPath(
  new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url),
);
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const TEXT_PDF = () => fixture("pdf-text-editable.pdf");
const IMAGE_PDF = () => fixture("pdf-image.pdf");

/** 8×8 opaque-red PNG via our own encoder — keeps the image op in-lane. */
function redPngB64(): string {
  const px = Buffer.alloc(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    px[i * 4] = 0; // B
    px[i * 4 + 1] = 0; // G
    px[i * 4 + 2] = 255; // R
    px[i * 4 + 3] = 255; // A
  }
  return encodeBgraToPng(px, 8, 8).toString("base64");
}

/** A copy of the text fixture with one saved /Text (note) annotation. */
async function pdfWithNote(): Promise<{ bytes: Uint8Array; objNum: number; rect: [number, number, number, number] }> {
  const doc = await PDFDocument.load(TEXT_PDF());
  const page = doc.getPage(0)!;
  const rect: [number, number, number, number] = [50, 700, 70, 720];
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: rect,
    Contents: PDFHexString.fromText("ghi chu kiem thu"),
  });
  const ref = doc.context.register(annot);
  let annots: PDFArray;
  try {
    annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
  } catch {
    annots = doc.context.obj([]);
    page.node.set(PDFName.of("Annots"), annots);
  }
  annots.push(ref);
  const bytes = await doc.save();
  return { bytes, objNum: ref.objectNumber, rect };
}

describe("pdf probe (open)", () => {
  it("reports page count, text layer and the OCR refusal", async () => {
    const probe = await probePdf(TEXT_PDF());
    expect(probe.pageCount).toBe(2);
    expect(probe.hasTextLayer).toBe(true);
    expect(probe.emptyTextPages).toEqual([]);
    expect(probe.features.ocr).toBe(false);
    expect(probe.features.ocrReason).toContain("Q2-A");
  });

  it("reports a scanned page as having no text layer", async () => {
    const probe = await probePdf(fixture("pdf-scanned-page.pdf"));
    expect(probe.hasTextLayer).toBe(false);
    expect(probe.emptyTextPages).toEqual([1]);
  });
});

describe("pdf edit — text", () => {
  it("replaces text, verifies it, and leaves the original bytes untouched", async () => {
    const input = TEXT_PDF();
    const before = sha(input);
    const out = await applyPdfEditBytes(input, [
      {
        op: "putTextEdit",
        attributes: {
          pageIndex: 0,
          rect: [0, 0, 612, 792],
          oldText: "Bao cao tong hop nam 2026",
          newText: "Bao cao tong hop nam 2027",
          fontSize: 14,
        },
      },
    ]);
    expect(sha(input)).toBe(before); // original preserved
    expect(out.report.textEdits).toEqual({ applied: 1, skipped: 0 });
    // Independent read-back on the saved bytes.
    const text = await readPdfText(out.bytes);
    expect(text.pages[0]!.text).toContain("nam 2027");
    expect(text.pages[0]!.text).not.toContain("nam 2026");
  });

  it("renders differently before and after a text edit", async () => {
    const input = TEXT_PDF();
    const clip = { x: 0, y: 0, width: 612, height: 300 };
    const beforePng = await renderPageRegionPng(input, { pageIndex: 0, clip, pxWidth: 300 });
    const out = await applyPdfEditBytes(input, [
      {
        op: "putTextEdit",
        attributes: {
          pageIndex: 0,
          rect: [0, 0, 612, 792],
          oldText: "Bao cao tong hop nam 2026",
          newText: "XXXXXXXXXXXXXXXXXXXXXXXXXX",
          fontSize: 14,
        },
      },
    ]);
    const afterPng = await renderPageRegionPng(out.bytes, { pageIndex: 0, clip, pxWidth: 300 });
    const pxBefore = decodeImageToBgra(Buffer.from(beforePng!, "base64"));
    const pxAfter = decodeImageToBgra(Buffer.from(afterPng!, "base64"));
    let diff = 0;
    for (let i = 0; i < pxBefore.bgra.length; i++) if (pxBefore.bgra[i] !== pxAfter.bgra[i]) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  it("inserts Vietnamese text through the bundled Noto subset", async () => {
    const input = TEXT_PDF();
    const out = await applyPdfEditBytes(input, [
      {
        op: "addTextInsert",
        attributes: {
          pageIndex: 0,
          origin: [72, 500],
          text: "Tiếng Việt đầy đủ dấu",
          fontSize: 12,
          color: [0, 0, 200],
          font: "noto",
        },
      },
    ]);
    const text = await readPdfText(out.bytes);
    expect(text.pages[0]!.text).toContain("Tiếng Việt đầy đủ dấu");
  });

  it("skips a stale edit and reports it instead of failing the batch", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      {
        op: "putTextEdit",
        attributes: {
          pageIndex: 0,
          rect: [0, 0, 612, 792],
          oldText: "this string does not exist",
          newText: "anything",
          fontSize: 14,
        },
      },
    ]);
    expect(out.report.textEdits.skipped).toBe(1);
    expect(out.warnings.some((w) => w.code === "edit_skipped")).toBe(true);
  });
});

describe("pdf edit — mixed batch", () => {
  it("applies image, rotation, reorder and metadata in one job", async () => {
    const input = TEXT_PDF();
    const out = await applyPdfEditBytes(input, [
      {
        op: "addImageEdit",
        attributes: {
          kind: "insertImage",
          pageIndex: 0,
          image: redPngB64(),
          rect: [300, 500, 340, 540],
          layer: "aboveText",
        },
      },
      { op: "rotatePages", attributes: { pages: [0], dir: 90 } },
      { op: "setPageOrder", attributes: { order: [1, 0] } },
      { op: "setMetadata", attributes: { title: "Đổi tên", author: "UniWork" } },
    ]);
    expect(out.warnings).toEqual([]);
    const text = await readPdfText(out.bytes);
    // Reordered: original page 2 is now first.
    expect(text.pages[0]!.text).toContain("Trang hai");
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getTitle()).toBe("Đổi tên");
    // Rotated: page 1 (original index 0, moved to slot 2) is now landscape.
    const p2 = doc.getPage(1)!;
    expect(p2.getRotation().angle % 180).toBe(90);
  });

  it("deletes a page and refuses to empty the document", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      { op: "deletePage", attributes: { pageIndex: 1 } },
    ]);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    const text = await readPdfText(out.bytes);
    expect(text.pages[0]!.text).toContain("Bao cao");
  });

  it("deletes a saved annotation by guarded identity", async () => {
    const { bytes, objNum, rect } = await pdfWithNote();
    const out = await applyPdfEditBytes(bytes, [
      {
        op: "deleteSavedAnnot",
        attributes: { pageIndex: 0, objNum, subtype: "note", rect, contents: "ghi chu kiem thu" },
      },
    ]);
    const doc = await PDFDocument.load(out.bytes);
    const page0 = doc.getPage(0)!.node;
    const rawAnnots = page0.get(PDFName.of("Annots"));
    const count = rawAnnots ? doc.context.lookup(rawAnnots, PDFArray).size() : 0;
    expect(count).toBe(0);
  });
});

describe("pdf edit — two-save persistence", () => {
  it("a second edit on the saved output still applies (save → reopen → save)", async () => {
    const first = await applyPdfEditBytes(TEXT_PDF(), [
      {
        op: "putTextEdit",
        attributes: {
          pageIndex: 0,
          rect: [0, 0, 612, 792],
          oldText: "Bao cao tong hop nam 2026",
          newText: "Bao cao tong hop nam 2027",
          fontSize: 14,
        },
      },
    ]);
    const second = await applyPdfEditBytes(first.bytes, [
      {
        op: "putTextEdit",
        attributes: {
          pageIndex: 0,
          rect: [0, 0, 612, 792],
          oldText: "Bao cao tong hop nam 2027",
          newText: "Bao cao tong hop nam 2028",
          fontSize: 14,
        },
      },
    ]);
    const text = await readPdfText(second.bytes);
    expect(text.pages[0]!.text).toContain("nam 2028");
    expect(text.pages[0]!.text).not.toContain("2027");
  });

  it.each(["highlight", "underline", "strikeout"] as const)("writes a %s text markup without changing page content", async (type) => {
    const input = TEXT_PDF();
    const before = await readPdfText(input);
    const out = await applyPdfEditBytes(input, [{
      op: "addMarkup",
      attributes: {
        markup: {
          pageIndex: 0,
          type,
          color: [1, 0.8, 0],
          quads: [[72, 710, 190, 710, 72, 695, 190, 695]],
        },
      },
    }]);
    expect(await readPdfText(out.bytes)).toEqual(before);
    const doc = await PDFDocument.load(out.bytes);
    const page = doc.getPage(0)!;
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeDefined();
    const refs = doc.context.lookup(annots!, PDFArray);
    const annot = doc.context.lookup(refs.get(0)!, PDFDict);
    expect(annot.get(PDFName.of("Subtype"))).toEqual(PDFName.of(type === "strikeout" ? "StrikeOut" : type[0]!.toUpperCase() + type.slice(1)));
  });

  it("keeps a markup on a second save and appends the second annotation", async () => {
    const first = await applyPdfEditBytes(TEXT_PDF(), [{
      op: "addMarkup",
      attributes: { markup: { pageIndex: 0, type: "highlight", color: [1, 1, 0], quads: [[72, 710, 190, 710, 72, 695, 190, 695]] } },
    }]);
    const second = await applyPdfEditBytes(first.bytes, [{
      op: "addMarkup",
      attributes: { markup: { pageIndex: 0, type: "underline", color: [0, 0, 1], quads: [[72, 680, 190, 680, 72, 665, 190, 665]] } },
    }]);
    const doc = await PDFDocument.load(second.bytes);
    const annots = doc.context.lookup(doc.getPage(0)!.node.get(PDFName.of("Annots"))!, PDFArray);
    expect(annots.size()).toBe(2);
  });
});

describe("pdf edit — typed refusals", () => {
  it.each([
    ["pdf-cert-encrypted.pdf", "encrypted_pdf"],
    ["pdf-password-4spaces.pdf", "encrypted_pdf"],
    ["pdf-corrupt.pdf", "corrupt_pdf"],
  ])("refuses %s as %s keeping typed code", async (file, reason) => {
    await expect(
      applyPdfEditBytes(fixture(file), [
        { op: "setMetadata", attributes: { title: "x" } },
      ]),
    ).rejects.toMatchObject({ name: "PdfTypedError", code: "engine_result_invalid", reason });
  });

  it("refuses non-pdf bytes", async () => {
    await expect(applyPdfEditBytes(new Uint8Array(Buffer.from("not a pdf")), [])).rejects.toMatchObject({
      code: "engine_result_invalid",
      reason: "not_a_pdf",
    });
  });

  it("refuses an OCR op as unsupported", async () => {
    await expect(
      applyPdfEditBytes(TEXT_PDF(), [{ op: "ocrPage", attributes: { pageIndex: 0 } }]),
    ).rejects.toMatchObject({ code: "unsupported_operation" });
  });

  it("refuses an unknown op as unsupported", async () => {
    await expect(
      applyPdfEditBytes(TEXT_PDF(), [{ op: "addUnknownThing", attributes: {} }]),
    ).rejects.toMatchObject({ code: "unsupported_operation" });
  });

  it("refuses a malformed op field", async () => {
    await expect(
      applyPdfEditBytes(TEXT_PDF(), [
        { op: "putTextEdit", attributes: { pageIndex: "zero" } },
      ]),
    ).rejects.toMatchObject({ code: "engine_result_invalid", reason: expect.stringContaining("bad_op") });
  });

  it("names malformed markup fields as typed parse errors", async () => {
    await expect(applyPdfEditBytes(TEXT_PDF(), [{
      op: "addMarkup",
      attributes: { markup: { pageIndex: 0, type: "highlight", color: [1, 1], quads: [[1, 2, 3, 4, 5, 6, 7, 8]] } },
    }])).rejects.toMatchObject({ code: "engine_result_invalid", reason: expect.stringContaining("bad_op:addMarkup.color") });
  });

  it("is a PdfTypedError instance so handlers map it 1:1", async () => {
    await expect(probePdf(new Uint8Array(Buffer.from("junk")))).rejects.toBeInstanceOf(PdfTypedError);
  });
});

describe("pdf edit — guard honesty (reviewer r1)", () => {
  it("a content-stream '/Encrypt <<' mention does not refuse a plain pdf", async () => {
    // The sniff scans only the trailer/xref dicts at the tail — a literal in a
    // page's content stream is just bytes, not an encryption dictionary.
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]).drawText("/Encrypt << /V 2 /R 2 >> in a stream", { x: 20, y: 200, size: 10 });
    const bytes = await doc.save();
    const probe = await probePdf(bytes);
    expect(probe.pageCount).toBe(1);
    expect(probe.hasTextLayer).toBe(true);
  });

  it("trailing bytes mentioning /Encrypt after %%EOF do not refuse either", async () => {
    const input = TEXT_PDF();
    const extra = Buffer.from("\n% just a comment /Encrypt << /V 2 >>\n", "latin1");
    const padded = new Uint8Array(input.length + extra.length);
    padded.set(input, 0);
    padded.set(new Uint8Array(extra.buffer, extra.byteOffset, extra.length), input.length);
    const probe = await probePdf(padded);
    expect(probe.pageCount).toBe(2);
  });

  it("annotDeletes report requested-vs-removed honestly", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      {
        op: "deleteSavedAnnot",
        attributes: {
          pageIndex: 0,
          objNum: 9999,
          subtype: "note",
          rect: [0, 0, 10, 10],
          contents: "nothing like this exists",
        },
      },
    ]);
    expect(out.report.annotDeletes).toEqual({ applied: 0, skipped: 1 });
    expect(out.warnings.some((w) => w.code === "edit_skipped")).toBe(true);
  });

  it("an out-of-range annot page is a skip, not a count", async () => {
    const out = await applyPdfEditBytes(TEXT_PDF(), [
      {
        op: "deleteSavedAnnot",
        attributes: { pageIndex: 99, objNum: 1, subtype: "note", rect: [0, 0, 1, 1] },
      },
    ]);
    expect(out.report.annotDeletes).toEqual({ applied: 0, skipped: 1 });
  });

  it("refuses an ops batch over the count cap as a typed bad_op", async () => {
    const edits = Array.from({ length: 1001 }, () => ({ op: "setMetadata", attributes: { title: "x" } }));
    await expect(applyPdfEditBytes(TEXT_PDF(), edits)).rejects.toMatchObject({
      code: "engine_result_invalid",
      reason: expect.stringContaining("bad_op"),
    });
  });

  it("refuses a decompression-bomb PNG header before decoding", () => {
    // 8-byte signature + a fake IHDR claiming 9000×9000 — never reaches pngjs.
    const head = Buffer.alloc(33);
    head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    head.writeUInt32BE(13, 8);
    head.write("IHDR", 12, "ascii");
    head.writeUInt32BE(9000, 16);
    head.writeUInt32BE(9000, 20);
    expect(() => decodeImageToBgra(head)).toThrowError(/image_too_large/);
  });
});

describe("pdf edit — image ops on the image fixture", () => {
  it("inserts an image and the read-back verification sees it", async () => {
    const out = await applyPdfEditBytes(IMAGE_PDF(), [
      {
        op: "addImageEdit",
        attributes: {
          kind: "insertImage",
          pageIndex: 0,
          image: redPngB64(),
          rect: [100, 600, 160, 660],
          layer: "aboveText",
        },
      },
    ]);
    expect(out.report.imageEdits).toEqual({ applied: 1, skipped: 0 });
    // The saved bytes still parse and keep their text.
    const text = await readPdfText(out.bytes);
    expect(text.pages[0]!.text).toContain("anh nhu");
  });
});
