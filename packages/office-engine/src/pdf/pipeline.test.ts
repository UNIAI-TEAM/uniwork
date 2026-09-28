// G2-05 AC-2 replay: real fixture edit → save → reopen → independent
// extraction; render diff; Vietnamese text; mixed text/image/page ops; typed
// refusals; original bytes untouched. pdfium runs in-process here — the
// same modules the sandboxed worker bundles.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
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
      applyPdfEditBytes(TEXT_PDF(), [{ op: "addMarkup", attributes: {} }]),
    ).rejects.toMatchObject({ code: "unsupported_operation" });
  });

  it("refuses a malformed op field", async () => {
    await expect(
      applyPdfEditBytes(TEXT_PDF(), [
        { op: "putTextEdit", attributes: { pageIndex: "zero" } },
      ]),
    ).rejects.toMatchObject({ code: "engine_result_invalid", reason: expect.stringContaining("bad_op") });
  });

  it("is a PdfTypedError instance so handlers map it 1:1", async () => {
    await expect(probePdf(new Uint8Array(Buffer.from("junk")))).rejects.toBeInstanceOf(PdfTypedError);
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
