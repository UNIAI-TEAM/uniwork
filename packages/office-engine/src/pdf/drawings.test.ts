import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyPdfEditBytes } from "./adapter";
import { readPdfText } from "./extract";

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText("keep this content", { x: 24, y: 260, size: 12 });
  return doc.save();
}

describe("pdf drawing and ink annotations", () => {
  it("writes shape and ink annotations without rewriting text", async () => {
    const input = await fixture();
    const before = await readPdfText(input);
    const out = await applyPdfEditBytes(input, [
      { op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "rect", geometry: { rect: { x: 20, y: 20, width: 80, height: 60 } }, color: [1, 0, 0], width: 2 } } },
      { op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "ellipse", geometry: { rect: { x: 110, y: 20, width: 70, height: 60 } }, color: [0, 1, 0], width: 1, fill: [0.8, 0.8, 0] } } },
      { op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "line", geometry: { start: { x: 20, y: 100 }, end: { x: 100, y: 150 } }, color: [0, 0, 1], width: 1 } } },
      { op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "arrow", geometry: { start: { x: 110, y: 100 }, end: { x: 180, y: 150 } }, color: [0, 0, 0], width: 2 } } },
      { op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "ink", geometry: { points: [{ x: 20, y: 180 }, { x: 40, y: 190 }, { x: 60, y: 180 }, { x: 80, y: 190 }, { x: 100, y: 180 }] }, color: [0, 0, 0], width: 2 } } },
    ]);
    expect(out.report.drawings).toEqual({ applied: 5, skipped: 0 });
    expect((await readPdfText(out.bytes)).pages[0]!.text).toBe(before.pages[0]!.text);
    const doc = await PDFDocument.load(out.bytes);
    const annots = doc.context.lookup(doc.getPage(0)!.node.get(PDFName.of("Annots"))!, PDFArray);
    expect(annots.size()).toBe(5);
    expect(annots.lookup(0, PDFDict).get(PDFName.of("Subtype"))?.toString()).toBe("/Square");
    expect(annots.lookup(1, PDFDict).get(PDFName.of("Subtype"))?.toString()).toBe("/Circle");
    expect(annots.lookup(2, PDFDict).get(PDFName.of("Subtype"))?.toString()).toBe("/Line");
    expect(annots.lookup(4, PDFDict).get(PDFName.of("Subtype"))?.toString()).toBe("/Ink");
    const second = await applyPdfEditBytes(out.bytes, [{ op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "rect", geometry: { rect: { x: 200, y: 20, width: 20, height: 20 } }, color: [0, 0, 0], width: 1 } } }]);
    const doc2 = await PDFDocument.load(second.bytes);
    const annots2 = doc2.context.lookup(doc2.getPage(0)!.node.get(PDFName.of("Annots"))!, PDFArray);
    expect(annots2.size()).toBe(6);
  });

  it("rejects malformed shapes and inks with typed field errors", async () => {
    const input = await fixture();
    await expect(applyPdfEditBytes(input, [{ op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "triangle", geometry: { rect: { x: 0, y: 0, width: 1, height: 1 } }, color: [0, 0, 0], width: 1 } } }])).rejects.toMatchObject({ code: "engine_result_invalid", reason: expect.stringContaining("bad_op:addDrawing.kind") });
    await expect(applyPdfEditBytes(input, [{ op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "ink", geometry: { points: [{ x: 0, y: 0 }] }, color: [0, 0, 0], width: 1 } } }])).rejects.toMatchObject({ code: "engine_result_invalid", reason: expect.stringContaining("bad_op:addDrawing.geometry.points") });
  });

  it("reports an out-of-range drawing as skipped without touching bytes", async () => {
    const input = await fixture();
    const out = await applyPdfEditBytes(input, [{ op: "addDrawing", attributes: { drawing: { pageIndex: 9, kind: "rect", geometry: { rect: { x: 1, y: 1, width: 4, height: 4 } }, color: [0, 0, 0], width: 1 } } }]);
    expect(out.report.drawings).toEqual({ applied: 0, skipped: 1 });
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(1);
  });
});
