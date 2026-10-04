import { describe, expect, it } from "vitest";
import { DOCX_IMAGE_WRAPS } from "@uniwork/office-engine/docx";
import {
  acceptedImageMime,
  aspectPartner,
  clampCrop,
  cropPxRect,
  docxImageAttrsPatch,
  fitImageSize,
  imageBytesFromDataUrl,
  isFullCrop,
  parseImagePx,
  readDocxImageInfo,
  readDocxImageRawContext,
} from "./docx-image-model";

const rawCtx = (attrs: Record<string, unknown>) => readDocxImageRawContext(attrs);

describe("image file/mime probing", () => {
  it("accepts typed png/jpeg/gif files and falls back to the extension", () => {
    expect(acceptedImageMime({ name: "a.png", type: "image/png" })).toBe("image/png");
    expect(acceptedImageMime({ name: "a.JPG", type: "" })).toBe("image/jpeg");
    expect(acceptedImageMime({ name: "a.gif" })).toBe("image/gif");
  });

  it("refuses anything the writer cannot embed", () => {
    expect(acceptedImageMime({ name: "a.webp", type: "image/webp" })).toBeNull();
    expect(acceptedImageMime({ name: "a.svg", type: "" })).toBeNull();
    expect(acceptedImageMime({ name: "a", type: "image/png" })).toBe("image/png");
  });

  it("parses only engine mimes out of data URLs", () => {
    expect(imageBytesFromDataUrl("data:image/jpeg;base64,QUJD")).toEqual({ mime: "image/jpeg", base64: "QUJD" });
    expect(imageBytesFromDataUrl("data:image/svg+xml;base64,QUJD")).toBeNull();
    expect(imageBytesFromDataUrl("not-a-data-url")).toBeNull();
  });
});

describe("readDocxImageInfo", () => {
  it("reads the docProtected image attrs and validates enums", () => {
    const info = readDocxImageInfo({
      blockType: "image",
      docxIndex: 4,
      imageDataUrl: "data:image/png;base64,AQID",
      imageWidthPx: 200,
      imageHeightPx: 120,
      imageAlign: "center",
      imageWrap: "square-right",
      imageOffsetXEmu: 9525,
      imageOffsetYEmu: 19050,
      imagePosH: "left",
      imagePosV: "bottom",
      imageRotDeg: 270,
      imageFlipH: true,
      genImage: { altText: "Ảnh nhóm" },
    });
    expect(info).toMatchObject({
      docxIndex: 4,
      widthPx: 200,
      heightPx: 120,
      align: "center",
      wrap: "square-right",
      offsetXEmu: 9525,
      offsetYEmu: 19050,
      posH: "left",
      posV: "bottom",
      rotDeg: 270,
      flipH: true,
      flipV: false,
      altText: "Ảnh nhóm",
    });
  });

  it("nulls bogus wrap/align values and refuses non-image nodes", () => {
    const info = readDocxImageInfo({ blockType: "image", imageWrap: "diagonal", imageAlign: "justify" });
    expect(info?.wrap).toBeNull();
    expect(info?.align).toBeNull();
    expect(readDocxImageInfo({ blockType: "table" })).toBeNull();
    expect(readDocxImageInfo(null)).toBeNull();
  });
});

describe("docxImageAttrsPatch", () => {
  const original = { docxIndex: 2, genImage: null } as const;
  const pending = { docxIndex: null, genImage: { base64: "QUJD", mime: "image/png", widthPx: 10, heightPx: 5 } } as const;

  it("size patches both attrs and the pending genImage", () => {
    expect(docxImageAttrsPatch(rawCtx({ ...original }), { kind: "size", widthPx: 320, heightPx: 160 })).toEqual({
      imageWidthPx: 320,
      imageHeightPx: 160,
    });
    expect(docxImageAttrsPatch(rawCtx({ ...pending }), { kind: "size", widthPx: 320, heightPx: 160 })).toEqual({
      imageWidthPx: 320,
      imageHeightPx: 160,
      genImage: { base64: "QUJD", mime: "image/png", widthPx: 320, heightPx: 160 },
    });
  });

  it("wrap null clears every anchor hint and the pending offset", () => {
    expect(docxImageAttrsPatch(rawCtx({ ...pending }), { kind: "wrap", wrap: null })).toEqual({
      imageWrap: null,
      imagePosH: null,
      imagePosV: null,
      imageOffsetXEmu: null,
      imageOffsetYEmu: null,
      genImage: { base64: "QUJD", mime: "image/png", widthPx: 10, heightPx: 5 },
    });
  });

  it("position presets are original-image only (genoffice parity)", () => {
    const patch = docxImageAttrsPatch(rawCtx({ ...original }), { kind: "position", h: "right", v: "bottom" });
    expect(patch).toEqual({
      imageWrap: "square-right",
      imagePosH: "right",
      imagePosV: "bottom",
      imageOffsetXEmu: null,
      imageOffsetYEmu: null,
    });
    expect(docxImageAttrsPatch(rawCtx({ ...pending }), { kind: "position", h: "right", v: "bottom" })).toBeNull();
  });

  it("offsets patch the attrs and ride genImage.posOffsetEmu for pending pictures", () => {
    expect(docxImageAttrsPatch(rawCtx({ ...pending }), { kind: "offset", xEmu: 9525, yEmu: 19050 })).toEqual({
      imageOffsetXEmu: 9525,
      imageOffsetYEmu: 19050,
      imagePosH: null,
      imagePosV: null,
      genImage: { base64: "QUJD", mime: "image/png", widthPx: 10, heightPx: 5, posOffsetEmu: { x: 9525, y: 19050 } },
    });
    expect(docxImageAttrsPatch(rawCtx({ ...pending }), { kind: "offset", xEmu: null, yEmu: null })).toEqual({
      imageOffsetXEmu: null,
      imageOffsetYEmu: null,
      imagePosH: null,
      imagePosV: null,
      genImage: { base64: "QUJD", mime: "image/png", widthPx: 10, heightPx: 5 },
    });
  });

  it("rotates on the 0..359 wheel (0 stores null)", () => {
    expect(docxImageAttrsPatch(rawCtx({ ...original }), { kind: "rotate", deg: 90 })).toEqual({ imageRotDeg: 90 });
    expect(docxImageAttrsPatch(rawCtx({ ...original }), { kind: "rotate", deg: 360 })).toEqual({ imageRotDeg: null });
    expect(docxImageAttrsPatch(rawCtx({ ...original }), { kind: "rotate", deg: -90 })).toEqual({ imageRotDeg: 270 });
    expect(docxImageAttrsPatch(rawCtx({ ...original }), { kind: "rotate", deg: 450 })).toEqual({ imageRotDeg: 90 });
  });

  it("flips both axes", () => {
    expect(docxImageAttrsPatch(rawCtx({ ...original }), { kind: "flip", flipH: true, flipV: true })).toEqual({
      imageFlipH: true,
      imageFlipV: true,
    });
  });

  it("bytes on an original picture ride imageReplace and drop a stale crop window", () => {
    expect(docxImageAttrsPatch(rawCtx({ ...original }), { kind: "bytes", base64: "Q1JPUA==", mime: "image/jpeg", widthPx: 200, heightPx: 80 })).toEqual({
      imageDataUrl: "data:image/jpeg;base64,Q1JPUA==",
      imageWidthPx: 200,
      imageHeightPx: 80,
      imageCrop: null,
      imageFillRect: null,
      imageReplace: { base64: "Q1JPUA==", mime: "image/jpeg" },
    });
  });

  it("bytes on a pending picture update genImage instead of imageReplace", () => {
    expect(docxImageAttrsPatch(rawCtx({ ...pending }), { kind: "bytes", base64: "Q1JPUA==", mime: "image/jpeg", widthPx: 40, heightPx: 20 })).toEqual({
      imageDataUrl: "data:image/jpeg;base64,Q1JPUA==",
      imageWidthPx: 40,
      imageHeightPx: 20,
      imageCrop: null,
      imageFillRect: null,
      genImage: { base64: "Q1JPUA==", mime: "image/jpeg", widthPx: 40, heightPx: 20 },
    });
  });
});

describe("sizing and crop math", () => {
  it("fitImageSize scales above the default width and leaves smaller pictures alone", () => {
    expect(fitImageSize({ width: 1000, height: 500 }, 620)).toEqual({ width: 620, height: 310 });
    expect(fitImageSize({ width: 300, height: 150 }, 620)).toEqual({ width: 300, height: 150 });
  });

  it("aspectPartner keeps the ratio and clamps", () => {
    expect(aspectPartner({ width: 200, height: 100 }, "width", 50)).toBe(25);
    expect(aspectPartner({ width: 200, height: 100 }, "height", 50)).toBe(100);
    expect(parseImagePx("0")).toBeNull();
    expect(parseImagePx("120")).toBe(120);
    expect(parseImagePx("abc")).toBeNull();
  });

  it("clampCrop keeps the region ordered and non-degenerate", () => {
    expect(clampCrop({ l: 0.9, t: 0.1, r: 0.2, b: 0.9 })).toEqual({ l: 0.9, t: 0.1, r: 0.95, b: 0.9 });
    expect(isFullCrop({ l: 0, t: 0, r: 1, b: 1 })).toBe(true);
    expect(isFullCrop({ l: 0.1, t: 0, r: 1, b: 1 })).toBe(false);
  });

  it("cropPxRect converts fractions to integer source pixels", () => {
    expect(cropPxRect({ l: 0.25, t: 0.5, r: 0.75, b: 1 }, 400, 200)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });

  it("keeps the wrap list in the engine's order", () => {
    expect(DOCX_IMAGE_WRAPS).toHaveLength(9);
  });
});
