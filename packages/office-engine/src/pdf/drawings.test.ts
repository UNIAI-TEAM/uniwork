import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
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
    const appearance = (index: number): string =>
      annots.lookup(index, PDFDict).lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N"), PDFStream).getContentsString();
    expect(appearance(0)).toContain(" re S");
    expect(appearance(0)).not.toContain(" rg");
    const ellipse = appearance(1);
    expect(ellipse).toContain("0.8 0.8 0 rg");
    expect(ellipse.endsWith("B")).toBe(true);
    expect(ellipse).not.toContain(" re ");
    expect(annots.lookup(2, PDFDict).lookup(PDFName.of("L"), PDFArray).asArray().map((value) => value.toString())).toEqual(["20", "100", "100", "150"]);
    const arrow = annots.lookup(3, PDFDict);
    expect(arrow.lookup(PDFName.of("LE"), PDFArray).asArray().map((value) => value.toString())).toEqual(["/None", "/OpenArrow"]);
    expect(arrow.lookup(PDFName.of("L"), PDFArray).asArray().map((value) => value.toString())).toEqual(["110", "100", "180", "150"]);
    expect(annots.lookup(4, PDFDict).lookup(PDFName.of("InkList"), PDFArray).toString()).toBe("[ [ 20 180 40 190 60 180 80 190 100 180 ] ]");
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

  it.each(["line", "arrow"] as const)("refuses %s geometry without start/end", async (kind) => {
    const input = await fixture();
    const refusal = { code: "engine_result_invalid", reason: expect.stringContaining("bad_op:addDrawing.geometry: line and arrow require start/end") };
    await expect(applyPdfEditBytes(input, [{ op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind, geometry: { rect: { x: 0, y: 0, width: 10, height: 10 } }, color: [0, 0, 0], width: 1 } } }])).rejects.toMatchObject(refusal);
    await expect(applyPdfEditBytes(input, [{ op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind, geometry: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, color: [0, 0, 0], width: 1 } } }])).rejects.toMatchObject(refusal);
  });

  it("pads a zero-height line rect by half the stroke width", async () => {
    const input = await fixture();
    const out = await applyPdfEditBytes(input, [{ op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "line", geometry: { start: { x: 20, y: 100 }, end: { x: 100, y: 100 } }, color: [0, 0, 0], width: 2 } } }]);
    const doc = await PDFDocument.load(out.bytes);
    const annots = doc.context.lookup(doc.getPage(0)!.node.get(PDFName.of("Annots"))!, PDFArray);
    expect(annots.lookup(0, PDFDict).lookup(PDFName.of("Rect"), PDFArray).asArray().map((value) => value.toString())).toEqual(["19", "99", "101", "101"]);
  });

  it("reports an out-of-range drawing as skipped without touching bytes", async () => {
    const input = await fixture();
    const out = await applyPdfEditBytes(input, [{ op: "addDrawing", attributes: { drawing: { pageIndex: 9, kind: "rect", geometry: { rect: { x: 1, y: 1, width: 4, height: 4 } }, color: [0, 0, 0], width: 1 } } }]);
    expect(out.report.drawings).toEqual({ applied: 0, skipped: 1 });
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(1);
  });
});
