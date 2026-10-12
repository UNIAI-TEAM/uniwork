// Rasterization through real pdfium: renderImagePng, renderPageRegionPng
// (exclusions, rotation, bad clips) and verifyImageEdits read-back.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { decodeImageToBgra } from "./codec";
import { applyImageEdits } from "./image";
import { renderImagePng, renderPageRegionPng, verifyImageEdits } from "./render";

type Rect = [number, number, number, number];

const FIXTURES = fileURLToPath(new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));
const IMAGE_PDF = () => fixture("pdf-image.pdf");
const TEXT_PDF = () => fixture("pdf-text-editable.pdf");

// pdf-image.pdf page 0 is 595.28 x 841.89 pt; its image spans x 72..168, y 641.89..737.89 (y up),
// i.e. display y 104..200 (y down).
const IMAGE_RECT: Rect = [72, 641.89, 168, 737.89];
const IMAGE_CLIP = { x: 72, y: 104, width: 96, height: 96 };

const decode = (b64: string | null) => {
  expect(b64).not.toBeNull();
  return decodeImageToBgra(Buffer.from(b64!, "base64"));
};
const nonWhite = (bgra: Buffer) => {
  let n = 0;
  for (let i = 0; i < bgra.length; i += 4) {
    if (bgra[i] !== 255 || bgra[i + 1] !== 255 || bgra[i + 2] !== 255) n++;
  }
  return n;
};

describe("renderImagePng", () => {
  it("renders the image object at roughly its on-page size", async () => {
    const img = decode(await renderImagePng(IMAGE_PDF(), 0, IMAGE_RECT));
    expect(img.width).toBeGreaterThan(40);
    expect(img.width).toBeLessThanOrEqual(110);
    expect(img.height).toBeGreaterThan(40);
    expect(nonWhite(img.bgra)).toBeGreaterThan(0);
  });

  it("renders a larger bitmap for scale above 1 and clamps scale below 1", async () => {
    const base = decode(await renderImagePng(IMAGE_PDF(), 0, IMAGE_RECT));
    const big = decode(await renderImagePng(IMAGE_PDF(), 0, IMAGE_RECT, 3));
    const small = decode(await renderImagePng(IMAGE_PDF(), 0, IMAGE_RECT, 0.2));
    expect(big.width).toBeGreaterThan(base.width * 2);
    expect(small.width).toBe(base.width);
  });

  // A 2400 px pdfium render plus a pure-JS PNG round trip: seconds on a fast box, past the
  // 30 s package default on a loaded GitHub runner.
  it("caps the upscaled render side at 2400 px", { timeout: 120_000 }, async () => {
    const huge = decode(await renderImagePng(IMAGE_PDF(), 0, IMAGE_RECT, 1000));
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(2400);
    expect(Math.max(huge.width, huge.height)).toBeGreaterThan(1500);
  });

  it("returns null when the page does not exist or no image matches the rect", async () => {
    expect(await renderImagePng(IMAGE_PDF(), 9, IMAGE_RECT)).toBeNull();
    expect(await renderImagePng(IMAGE_PDF(), 0, [300, 300, 340, 340])).toBeNull();
    expect(await renderImagePng(fixture("pdf-table.pdf"), 0, IMAGE_RECT)).toBeNull();
  });
});

describe("renderPageRegionPng", () => {
  const request = { pageIndex: 0, clip: IMAGE_CLIP, pxWidth: 96 };

  it("renders the clip at the requested pixel width with the clip's aspect", async () => {
    const img = decode(await renderPageRegionPng(IMAGE_PDF(), request));
    expect(img.width).toBe(96);
    expect(img.height).toBe(96);
    const wide = decode(await renderPageRegionPng(IMAGE_PDF(), { ...request, clip: { x: 0, y: 0, width: 200, height: 100 }, pxWidth: 100 }));
    expect([wide.width, wide.height]).toEqual([100, 50]);
  });

  it("erases an excluded image, leaving a white clip, without touching the input", async () => {
    const input = IMAGE_PDF();
    const withImage = decode(await renderPageRegionPng(input, request));
    const without = decode(await renderPageRegionPng(input, { ...request, excludeRects: [IMAGE_RECT] }));
    expect(nonWhite(withImage.bgra)).toBeGreaterThan(1000);
    expect(nonWhite(without.bgra)).toBe(0);
    // Unmatched exclusion rects are skipped fail-soft.
    const unmatched = decode(await renderPageRegionPng(input, { ...request, excludeRects: [[400, 400, 450, 450]] }));
    expect(unmatched.bgra.equals(withImage.bgra)).toBe(true);
  });

  it("swaps the display axes for an odd quarter-turn rotation", async () => {
    // A tall clip rendered one quarter turn clockwise shows different pixels than unrotated.
    const clip = { x: 0, y: 0, width: 300, height: 300 };
    const plain = decode(await renderPageRegionPng(IMAGE_PDF(), { pageIndex: 0, clip, pxWidth: 150 }));
    const turned = decode(await renderPageRegionPng(IMAGE_PDF(), { pageIndex: 0, clip, pxWidth: 150, rotate: 1 }));
    const negative = decode(await renderPageRegionPng(IMAGE_PDF(), { pageIndex: 0, clip, pxWidth: 150, rotate: -3 }));
    expect(turned.bgra.equals(plain.bgra)).toBe(false);
    expect(negative.bgra.equals(turned.bgra)).toBe(true); // -3 turns == 1 turn
  });

  it("returns null for a missing page and for degenerate clips or widths", async () => {
    expect(await renderPageRegionPng(IMAGE_PDF(), { ...request, pageIndex: 4 })).toBeNull();
    expect(await renderPageRegionPng(IMAGE_PDF(), { ...request, clip: { ...IMAGE_CLIP, width: 0 } })).toBeNull();
    expect(await renderPageRegionPng(IMAGE_PDF(), { ...request, clip: { ...IMAGE_CLIP, height: -1 } })).toBeNull();
    expect(await renderPageRegionPng(IMAGE_PDF(), { ...request, pxWidth: 0 })).toBeNull();
  });

  it("keeps annotations drawn when an annotation exclusion is active, and drops the excluded one", async () => {
    const doc = await PDFDocument.load(TEXT_PDF());
    const page = doc.getPage(0)!;
    const annots = doc.context.obj([]) as PDFArray;
    page.node.set(PDFName.of("Annots"), annots);
    const rect: [number, number, number, number] = [100, 600, 220, 640];
    const ref = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Square",
        Rect: rect,
        C: [1, 0, 0],
        BS: { W: 6 },
        Contents: PDFHexString.fromText("box"),
      } as never),
    );
    annots.push(ref);
    const bytes = await doc.save();
    // Display y = 792 - 640 .. 792 - 600 on a 612 x 792 page.
    const req = { pageIndex: 0, clip: { x: 90, y: 142, width: 140, height: 60 }, pxWidth: 140 };
    const plain = decode(await renderPageRegionPng(bytes, req));
    // The excluded entry names a subtype the guard cannot match for a Square, so nothing is removed;
    // the FPDF_ANNOT flag is on, which must not blank the clip.
    const flagged = decode(
      await renderPageRegionPng(bytes, {
        ...req,
        excludeAnnots: [{ pageIndex: 0, objNum: ref.objectNumber, subtype: "highlight", rect }],
      }),
    );
    expect(flagged.width).toBe(plain.width);
    expect(nonWhite(flagged.bgra)).toBeGreaterThan(0);
  });
});

describe("verifyImageEdits", () => {
  it("finds images at their rects and reports none for matching edits", async () => {
    expect(await verifyImageEdits(IMAGE_PDF(), [{ pageIndex: 0, rect: IMAGE_RECT }])).toEqual([]);
    expect(await verifyImageEdits(IMAGE_PDF(), [])).toEqual([]);
  });

  it("reports an image missing from the saved output, per rect", async () => {
    const failures = await verifyImageEdits(IMAGE_PDF(), [
      { pageIndex: 0, rect: IMAGE_RECT },
      { pageIndex: 0, rect: [300, 300, 340, 340] },
      { pageIndex: 0, rect: [10, 10, 20, 20] },
    ]);
    expect(failures).toEqual([
      { pageIndex: 0, reason: "image missing from saved output" },
      { pageIndex: 0, reason: "image missing from saved output" },
    ]);
  });

  it("reports pages that are not in the saved output", async () => {
    const failures = await verifyImageEdits(IMAGE_PDF(), [
      { pageIndex: 3, rect: IMAGE_RECT },
      { pageIndex: -1, rect: IMAGE_RECT },
    ]);
    expect(failures).toEqual([
      { pageIndex: 3, reason: "page missing from saved output" },
      { pageIndex: -1, reason: "page missing from saved output" },
    ]);
  });

  it("sees an inserted image after the edit is applied and saved", async () => {
    const target: Rect = [100, 100, 180, 160];
    const px = Buffer.alloc(4 * 4 * 4, 200);
    const { encodeBgraToPng } = await import("./codec");
    const png = encodeBgraToPng(px, 4, 4).toString("base64");
    const out = await applyImageEdits(IMAGE_PDF(), [
      { kind: "insertImage", pageIndex: 0, image: png, rect: target, layer: "aboveText" },
    ]);
    expect(await verifyImageEdits(out.bytes, [{ pageIndex: 0, rect: target }])).toEqual([]);
    expect(await verifyImageEdits(IMAGE_PDF(), [{ pageIndex: 0, rect: target }])).toEqual([
      { pageIndex: 0, reason: "image missing from saved output" },
    ]);
  });
});
