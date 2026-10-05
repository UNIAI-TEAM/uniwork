import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyPdfEditBytes } from "./adapter";

// 2x2 RGBA PNG (76 bytes): the smallest fixture that exercises the real embed.
const PNG_2X2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWOU0rb5zwAETAxQAAAWFgGEhurP+wAAAABJRU5ErkJggg==";

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText("keep this content", { x: 24, y: 260, size: 12 });
  return doc.save();
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

/** Number of image XObjects the page's resources carry. */
function xobjectCount(doc: PDFDocument, pageIndex: number): number {
  const resources = doc.getPage(pageIndex).node.get(PDFName.of("Resources"));
  if (!resources) return 0;
  const xobjects = doc.context.lookup(resources, PDFDict).get(PDFName.of("XObject"));
  return xobjects ? doc.context.lookup(xobjects, PDFDict).keys().length : 0;
}

/** Every `a b c d e f cm` matrix in a content stream, in document order.
    `cm` takes six operands, so its keyword sits at i+6. */
function cmMatrices(content: string): number[][] {
  const tokens = content.split(/\s+/);
  const out: number[][] = [];
  for (let i = 0; i + 6 < tokens.length; i++) {
    if (tokens[i + 6] !== "cm") continue;
    const nums = tokens.slice(i, i + 6).map(Number);
    if (nums.every((n) => Number.isFinite(n))) out.push(nums);
  }
  return out;
}

/** pdf-lib scales a rotation matrix by the image footprint, so a 90/270 turn
    shows as a zeroed diagonal with opposite-signed off-diagonal terms. */
const isQuarterTurn = (m: number[]): boolean =>
  Math.abs(m[0]!) < 1e-6 &&
  Math.abs(m[3]!) < 1e-6 &&
  Math.abs(m[1]!) > 1e-6 &&
  Math.abs(m[2]!) > 1e-6 &&
  Math.sign(m[1]!) !== Math.sign(m[2]!);

const stampOp = (stamp: Record<string, unknown>) => ({ op: "addStamp", attributes: { stamp } });

describe("pdf image and signature stamps", () => {
  it("round-trips an image stamp: edit, save, reopen, the page carries the image", async () => {
    const input = await fixture();
    const out = await applyPdfEditBytes(input, [
      stampOp({ kind: "image", pageIndex: 0, rect: [40, 40, 120, 100], contentType: "image/png", image: PNG_2X2 }),
    ]);
    expect(out.report.stamps).toEqual({ applied: 1, skipped: 0 });
    expect(out.warnings).toEqual([]);
    // A fresh reopen of the saved bytes — not the in-memory document.
    const reopened = await PDFDocument.load(out.bytes);
    expect(reopened.getPageCount()).toBe(1);
    expect(xobjectCount(reopened, 0)).toBe(1);
    const content = pageContent(reopened, 0);
    expect(content).toContain("Do");
    // The original page text survives: only the target page's content is added to.
    expect(content).toContain("6B656570207468697320636F6E74656E74");
  });

  it("draws a signature stamp through the same path and keeps it a plain image", async () => {
    const input = await fixture();
    const out = await applyPdfEditBytes(input, [
      stampOp({ kind: "signature", signatureId: "sig-42", pageIndex: 0, rect: [150, 40, 230, 90], contentType: "image/png", image: PNG_2X2 }),
    ]);
    expect(out.report.stamps).toEqual({ applied: 1, skipped: 0 });
    const reopened = await PDFDocument.load(out.bytes);
    expect(xobjectCount(reopened, 0)).toBe(1);
    expect(pageContent(reopened, 0)).toContain("Do");
  });

  it("applies the requested quarter turn to the drawn image", async () => {
    // A blank page keeps the stamp's `cm` the only one in the content stream.
    const blank = await PDFDocument.create();
    blank.addPage([300, 300]);
    const input = await blank.save();
    const draw = (quarterTurns?: number) =>
      applyPdfEditBytes(input, [
        stampOp({ kind: "image", pageIndex: 0, rect: [40, 40, 120, 100], contentType: "image/png", image: PNG_2X2, ...(quarterTurns === undefined ? {} : { quarterTurns }) }),
      ]);
    const straightContent = pageContent(await PDFDocument.load((await draw()).bytes), 0);
    const turnedContent = pageContent(await PDFDocument.load((await draw(90)).bytes), 0);
    // A rotation that was ignored would produce byte-identical content.
    expect(turnedContent).not.toBe(straightContent);
    expect(cmMatrices(straightContent).some(isQuarterTurn)).toBe(false);
    expect(cmMatrices(turnedContent).some(isQuarterTurn)).toBe(true);
  });

  it.each([90, 180, 270] as const)("accepts quarterTurns=%i", async (quarterTurns) => {
    const input = await fixture();
    const out = await applyPdfEditBytes(input, [
      stampOp({ kind: "image", pageIndex: 0, rect: [40, 40, 120, 100], contentType: "image/png", image: PNG_2X2, quarterTurns }),
    ]);
    expect(out.report.stamps).toEqual({ applied: 1, skipped: 0 });
  });

  it("refuses malformed stamp envelopes with typed field errors", async () => {
    const input = await fixture();
    const bad = (stamp: Record<string, unknown>, reason: string) =>
      expect(applyPdfEditBytes(input, [stampOp(stamp)])).rejects.toMatchObject({
        code: "engine_result_invalid",
        reason: expect.stringContaining(reason),
      });
    await bad({ kind: "sticker", pageIndex: 0, rect: [0, 0, 10, 10], contentType: "image/png", image: PNG_2X2 }, "bad_op:addStamp.kind");
    await bad({ kind: "image", pageIndex: 0, rect: [0, 0, 10, 10], contentType: "image/webp", image: PNG_2X2 }, "bad_op:addStamp.contentType");
    await bad({ kind: "image", pageIndex: 0, rect: [10, 10, 10, 20], contentType: "image/png", image: PNG_2X2 }, "bad_op:addStamp.rect");
    await bad({ kind: "image", pageIndex: 0, rect: [0, 0, 10], contentType: "image/png", image: PNG_2X2 }, "bad_op:addStamp.rect");
    await bad({ kind: "image", pageIndex: 0, rect: [0, 0, 10, 10], contentType: "image/png", image: PNG_2X2, quarterTurns: 45 }, "bad_op:addStamp.quarterTurns");
    await bad({ kind: "image", pageIndex: 0.5, rect: [0, 0, 10, 10], contentType: "image/png", image: PNG_2X2 }, "bad_op:addStamp.pageIndex");
    await bad({ kind: "image", pageIndex: 0, rect: [0, 0, 10, 10], contentType: "image/png", image: "" }, "bad_op:addStamp.image");
  });

  it("reports an undecodable image or out-of-range page as a skip, never a silent drop", async () => {
    const input = await fixture();
    const badImage = await applyPdfEditBytes(input, [
      stampOp({ kind: "image", pageIndex: 0, rect: [0, 0, 10, 10], contentType: "image/png", image: "bm90IGEgcG5n" }),
    ]);
    expect(badImage.report.stamps).toEqual({ applied: 0, skipped: 1 });
    expect(badImage.warnings).toHaveLength(1);
    expect(badImage.warnings[0]!.code).toBe("edit_skipped");

    const offPage = await applyPdfEditBytes(input, [
      stampOp({ kind: "image", pageIndex: 9, rect: [0, 0, 10, 10], contentType: "image/png", image: PNG_2X2 }),
    ]);
    expect(offPage.report.stamps).toEqual({ applied: 0, skipped: 1 });
    expect((await PDFDocument.load(offPage.bytes)).getPageCount()).toBe(1);
  });

  it("accumulates stamps across two saves", async () => {
    const input = await fixture();
    const first = await applyPdfEditBytes(input, [
      stampOp({ kind: "image", pageIndex: 0, rect: [10, 10, 50, 50], contentType: "image/png", image: PNG_2X2 }),
    ]);
    const second = await applyPdfEditBytes(first.bytes, [
      stampOp({ kind: "signature", signatureId: "sig-7", pageIndex: 0, rect: [60, 60, 100, 100], contentType: "image/png", image: PNG_2X2 }),
    ]);
    expect(second.report.stamps).toEqual({ applied: 1, skipped: 0 });
    const reopened = await PDFDocument.load(second.bytes);
    expect(xobjectCount(reopened, 0)).toBe(2);
    expect(pageContent(reopened, 0).match(/Do/g) ?? []).toHaveLength(2);
  });
});
