// Content-stream image ops on real fixtures through the real pdfium module:
// listing, matching, insert / transform / replace / delete, fail-soft skips.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";

import { decodeImageToBgra, encodeBgraToPng } from "./codec";
import { applyImageEdits, listPageImages, matchImage, type PageObj } from "./image";
import { renderImagePng } from "./render";
import type { ImageEditInput } from "./types";

type Rect = [number, number, number, number];

const FIXTURES = fileURLToPath(new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));

// pdf-image.pdf: one image on page 0, painted before any text.
const IMAGE_PDF = () => fixture("pdf-image.pdf");
const IMAGE_RECT: Rect = [72, 641.89, 168, 737.89];
// pdf-text-editable.pdf: page 0 text only, page 1 has an image painted after its text.
const TEXT_PDF = () => fixture("pdf-text-editable.pdf");
const TEXT_IMAGE_RECT: Rect = [72, 660, 144, 732];

function solidBgra(width: number, height: number, bgra: [number, number, number, number]): Buffer {
  const px = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) px.set(bgra, i * 4);
  return px;
}
const solidPngB64 = (bgra: [number, number, number, number], size = 8) =>
  encodeBgraToPng(solidBgra(size, size, bgra), size, size).toString("base64");
const RED_PNG = () => solidPngB64([0, 0, 255, 255]);
const GREEN_PNG = () => solidPngB64([0, 255, 0, 255]);

function solidJpegB64(): string {
  const data = Buffer.alloc(8 * 8 * 4);
  for (let i = 0; i < 64; i++) data.set([0, 0, 255, 255], i * 4);
  return Buffer.from(jpeg.encode({ data, width: 8, height: 8 }, 95).data).toString("base64");
}

const closeTo = (actual: readonly number[], expected: readonly number[], tol = 0.6) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(tol));
};

/** Centre pixel (BGRA) of the PNG that renderImagePng produced for the image at `rect`. */
async function centrePixel(bytes: Uint8Array, pageIndex: number, rect: Rect): Promise<number[]> {
  const b64 = await renderImagePng(bytes, pageIndex, rect);
  expect(b64).not.toBeNull();
  const img = decodeImageToBgra(Buffer.from(b64!, "base64"));
  const o = ((Math.floor(img.height / 2) * img.width + Math.floor(img.width / 2)) * 4) as number;
  return [...img.bgra.subarray(o, o + 4)];
}

const obj = (type: number, bounds: Rect, index = 0): PageObj => ({ obj: index + 100, index, type, bounds: [...bounds] });

describe("matchImage", () => {
  const IMAGE = 3;
  const TEXT = 1;

  it("returns the closest image within the 2pt tolerance and ignores non-image objects", () => {
    const far = obj(IMAGE, [0, 0, 50, 50], 0);
    const near = obj(IMAGE, [10.5, 10, 50, 50], 1);
    const nearer = obj(IMAGE, [10.2, 10, 50.1, 50], 2);
    const text = obj(TEXT, [10, 10, 50, 50], 3);
    expect(matchImage([far, text, near, nearer], [10, 10, 50, 50])).toBe(nearer);
    expect(matchImage([text], [10, 10, 50, 50])).toBeNull();
  });

  it("refuses a candidate whose farthest edge is beyond the tolerance", () => {
    expect(matchImage([obj(IMAGE, [10, 10, 50, 53.5])], [10, 10, 50, 50])).toBeNull();
    expect(matchImage([obj(IMAGE, [10, 10, 50, 51.9])], [10, 10, 50, 50])).not.toBeNull();
    expect(matchImage([], [0, 0, 1, 1])).toBeNull();
  });
});

describe("listPageImages", () => {
  it("lists a page's image with its rect and the below-text band", async () => {
    const images = await listPageImages(IMAGE_PDF());
    expect(images).toHaveLength(1);
    expect(images[0]!.pageIndex).toBe(0);
    closeTo(images[0]!.rect, IMAGE_RECT);
    expect(images[0]!.aboveText).toBe(false);
  });

  it("reports the page index and flags an image painted after the text as above it", async () => {
    const images = await listPageImages(TEXT_PDF());
    expect(images).toHaveLength(1);
    expect(images[0]!.pageIndex).toBe(1);
    closeTo(images[0]!.rect, TEXT_IMAGE_RECT);
    expect(images[0]!.aboveText).toBe(true);
  });

  it("returns nothing for documents without images", async () => {
    expect(await listPageImages(fixture("pdf-table.pdf"))).toEqual([]);
  });
});

describe("applyImageEdits", () => {
  it("skips an edit on a page that does not exist and returns the input bytes untouched", async () => {
    const input = IMAGE_PDF();
    const out = await applyImageEdits(input, [
      { kind: "deleteImage", pageIndex: 5, oldRect: IMAGE_RECT },
      { kind: "deleteImage", pageIndex: -1, oldRect: IMAGE_RECT },
    ]);
    expect(out.bytes).toBe(input);
    expect(out.skipped).toEqual([
      { editIndex: 0, pageIndex: 5, reason: "page does not exist" },
      { editIndex: 1, pageIndex: -1, reason: "page does not exist" },
    ]);
  });

  it("returns the input bytes when no edits are given", async () => {
    const input = IMAGE_PDF();
    const out = await applyImageEdits(input, []);
    expect(out.bytes).toBe(input);
    expect(out.skipped).toEqual([]);
  });

  it("deletes an image by its listed rect", async () => {
    const out = await applyImageEdits(IMAGE_PDF(), [{ kind: "deleteImage", pageIndex: 0, oldRect: IMAGE_RECT }]);
    expect(out.skipped).toEqual([]);
    expect(await listPageImages(out.bytes)).toEqual([]);
  });

  it("skips edits that cannot locate their image and keeps the original bytes", async () => {
    const input = IMAGE_PDF();
    const nowhere: Rect = [300, 300, 340, 340];
    const out = await applyImageEdits(input, [
      { kind: "deleteImage", pageIndex: 0, oldRect: nowhere },
      { kind: "transformImage", pageIndex: 0, oldRect: nowhere, rect: IMAGE_RECT },
      { kind: "replaceImage", pageIndex: 0, oldRect: nowhere, rect: IMAGE_RECT, image: RED_PNG() },
    ]);
    expect(out.bytes).toBe(input);
    expect(out.skipped.map((s) => [s.editIndex, s.reason])).toEqual([
      [0, "the image could not be located on the page"],
      [1, "the image could not be located on the page"],
      [2, "the image could not be located on the page"],
    ]);
  });

  it("moves and resizes an image to the requested rect", async () => {
    const target: Rect = [100, 300, 220, 360];
    const out = await applyImageEdits(IMAGE_PDF(), [
      { kind: "transformImage", pageIndex: 0, oldRect: IMAGE_RECT, rect: target },
    ]);
    expect(out.skipped).toEqual([]);
    const images = await listPageImages(out.bytes);
    expect(images).toHaveLength(1);
    closeTo(images[0]!.rect, target);
  });

  it("rotates a non-square image a quarter turn about its centre", async () => {
    const wide: Rect = [100, 300, 220, 360]; // 120 x 60
    const moved = await applyImageEdits(IMAGE_PDF(), [
      { kind: "transformImage", pageIndex: 0, oldRect: IMAGE_RECT, rect: wide },
    ]);
    // A quarter turn with the target rect equal to the rotated footprint (60 x 120 about the centre).
    const cx = 160;
    const cy = 330;
    const rotated: Rect = [cx - 30, cy - 60, cx + 30, cy + 60];
    const out = await applyImageEdits(moved.bytes, [
      { kind: "transformImage", pageIndex: 0, oldRect: wide, rect: rotated, quarterTurns: 1 },
    ]);
    expect(out.skipped).toEqual([]);
    closeTo((await listPageImages(out.bytes))[0]!.rect, rotated);
    // A negative count normalises to the same orientation family; four turns is the identity.
    const full = await applyImageEdits(moved.bytes, [
      { kind: "transformImage", pageIndex: 0, oldRect: wide, rect: wide, quarterTurns: 4 },
      { kind: "transformImage", pageIndex: 0, oldRect: wide, rect: wide, quarterTurns: -2 },
    ]);
    expect(full.skipped).toEqual([]);
    closeTo((await listPageImages(full.bytes))[0]!.rect, wide);
  });

  it("moves an image between the below-text and above-text bands", async () => {
    const down = await applyImageEdits(TEXT_PDF(), [
      { kind: "transformImage", pageIndex: 1, oldRect: TEXT_IMAGE_RECT, rect: TEXT_IMAGE_RECT, layer: "belowText" },
    ]);
    expect(down.skipped).toEqual([]);
    const lowered = await listPageImages(down.bytes);
    expect(lowered[0]!.aboveText).toBe(false);
    closeTo(lowered[0]!.rect, TEXT_IMAGE_RECT);
    const up = await applyImageEdits(down.bytes, [
      { kind: "transformImage", pageIndex: 1, oldRect: TEXT_IMAGE_RECT, rect: TEXT_IMAGE_RECT, layer: "aboveText" },
    ]);
    expect((await listPageImages(up.bytes))[0]!.aboveText).toBe(true);
  });

  it("replaces the pixels in place and keeps the footprint", async () => {
    const before = await centrePixel(IMAGE_PDF(), 0, IMAGE_RECT);
    const out = await applyImageEdits(IMAGE_PDF(), [
      { kind: "replaceImage", pageIndex: 0, oldRect: IMAGE_RECT, rect: IMAGE_RECT, image: RED_PNG() },
    ]);
    expect(out.skipped).toEqual([]);
    const after = await centrePixel(out.bytes, 0, IMAGE_RECT);
    expect(after).not.toEqual(before);
    expect(after[2]).toBeGreaterThan(200); // red
    expect(after[0]).toBeLessThan(60);
    closeTo((await listPageImages(out.bytes))[0]!.rect, IMAGE_RECT);
  });

  it("replaces with a JPEG, a new rect and a layer change in one edit", async () => {
    const target: Rect = [80, 500, 200, 600];
    const out = await applyImageEdits(TEXT_PDF(), [
      {
        kind: "replaceImage",
        pageIndex: 1,
        oldRect: TEXT_IMAGE_RECT,
        rect: target,
        image: solidJpegB64(),
        layer: "belowText",
        quarterTurns: 0,
      },
    ]);
    expect(out.skipped).toEqual([]);
    const [img] = await listPageImages(out.bytes);
    closeTo(img!.rect, target);
    expect(img!.aboveText).toBe(false);
  });

  it("inserts a PNG and a JPEG at their footprint rects, honouring the layer", async () => {
    const edits: ImageEditInput[] = [
      { kind: "insertImage", pageIndex: 0, image: RED_PNG(), rect: [50, 50, 150, 110], layer: "belowText" },
      { kind: "insertImage", pageIndex: 0, image: solidJpegB64(), rect: [200, 50, 260, 110], layer: "aboveText" },
    ];
    const out = await applyImageEdits(TEXT_PDF(), edits);
    expect(out.skipped).toEqual([]);
    const page0 = (await listPageImages(out.bytes)).filter((i) => i.pageIndex === 0);
    expect(page0).toHaveLength(2);
    const byX = [...page0].sort((a, b) => a.rect[0] - b.rect[0]);
    closeTo(byX[0]!.rect, [50, 50, 150, 110]);
    closeTo(byX[1]!.rect, [200, 50, 260, 110]);
    expect(byX[0]!.aboveText).toBe(false);
    expect(byX[1]!.aboveText).toBe(true);
  });

  it("inserts an image upright under every page rotation", async () => {
    for (const rotate of [90, 180, 270, 450, -90]) {
      const rect: Rect = [100, 100, 160, 200];
      const out = await applyImageEdits(IMAGE_PDF(), [
        { kind: "insertImage", pageIndex: 0, image: GREEN_PNG(), rect, layer: "aboveText", rotate },
      ]);
      expect(out.skipped, `rotate ${rotate}`).toEqual([]);
      const images = await listPageImages(out.bytes);
      expect(images, `rotate ${rotate}`).toHaveLength(2);
      const added = images.find((i) => Math.abs(i.rect[0] - rect[0]) < 1);
      expect(added, `rotate ${rotate}`).toBeDefined();
      closeTo(added!.rect, rect);
    }
  });

  it("skips an insert whose image bytes are neither PNG nor JPEG, and applies the rest", async () => {
    const out = await applyImageEdits(IMAGE_PDF(), [
      { kind: "insertImage", pageIndex: 0, image: Buffer.from("not an image").toString("base64"), rect: [10, 10, 40, 40], layer: "aboveText" },
      { kind: "deleteImage", pageIndex: 0, oldRect: IMAGE_RECT },
    ]);
    expect(out.skipped).toEqual([
      { editIndex: 0, pageIndex: 0, reason: "unsupported image data (PNG or JPEG required)" },
    ]);
    expect(await listPageImages(out.bytes)).toEqual([]);
  });

  it("skips a replace with undecodable bytes and leaves the document unchanged", async () => {
    const out = await applyImageEdits(IMAGE_PDF(), [
      { kind: "replaceImage", pageIndex: 0, oldRect: IMAGE_RECT, rect: IMAGE_RECT, image: "AAAA" },
    ]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]!.reason).toContain("unsupported image data");
  });

  it("reports an oversize image as a skip with the typed reason", async () => {
    const wide = encodeBgraToPng(solidBgra(8193, 1, [0, 0, 0, 255]), 8193, 1).toString("base64");
    const out = await applyImageEdits(IMAGE_PDF(), [
      { kind: "insertImage", pageIndex: 0, image: wide, rect: [10, 10, 40, 40], layer: "aboveText" },
    ]);
    expect(out.skipped[0]!.reason).toContain("image_too_large");
  });

  it("applies edits across pages with editIndex counted over the whole request", async () => {
    const out = await applyImageEdits(TEXT_PDF(), [
      { kind: "insertImage", pageIndex: 0, image: RED_PNG(), rect: [10, 10, 40, 40], layer: "aboveText" },
      { kind: "deleteImage", pageIndex: 1, oldRect: [1, 1, 5, 5] },
      { kind: "deleteImage", pageIndex: 1, oldRect: TEXT_IMAGE_RECT },
    ]);
    expect(out.skipped).toEqual([
      { editIndex: 1, pageIndex: 1, reason: "the image could not be located on the page" },
    ]);
    const images = await listPageImages(out.bytes);
    expect(images.map((i) => i.pageIndex)).toEqual([0]);
  });
});
