// Image codec seam — replaces upstream's Electron `nativeImage` dependency with
// the Advisor-approved pure-JS pair (pngjs decode/encode + jpeg-js decode): no
// native binary inside the sandboxed worker, and the same code runs on the
// desktop adapter. All buffers crossing this seam are BGRA straight alpha —
// the format pdfium's FPDFBitmap_BGRA produces and FPDFImageObj consumes.

import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

export interface DecodedImage {
  width: number;
  height: number;
  /** Straight-alpha BGRA, 4 bytes per pixel, row-major */
  bgra: Buffer;
}

function rgbaToBgra(rgba: Buffer): Buffer {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!;
    rgba[i] = rgba[i + 2]!;
    rgba[i + 2] = r;
  }
  return rgba;
}

function isPng(b: Buffer): boolean {
  return PNG_MAGIC.every((v, i) => b[i] === v);
}
function isJpeg(b: Buffer): boolean {
  return JPEG_MAGIC.every((v, i) => b[i] === v);
}

/** Decoded-image dimension cap: a compressed bomb can declare huge IHDR dims
    on a tiny file, and the BGRA expansion is 4 bytes per pixel — 8192² is
    256 MiB before pdfium even sees it. The worker's RSS cap would catch it
    anyway, but as an untyped limit kill; refuse early and typed instead. */
const MAX_IMAGE_DIM = 8192;

export class ImageTooLargeError extends Error {
  constructor(width: number, height: number) {
    super(`image_too_large: ${width}x${height}px exceeds the ${MAX_IMAGE_DIM}px bound`);
    this.name = "ImageTooLargeError";
  }
}

/** IHDR sits at a fixed offset right after the 8-byte PNG signature:
    chunk length @8, type @12, width @16, height @20. */
function pngDims(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.readUInt32BE(8) !== 13) return null; // IHDR len
  if (b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/**
 * Decode a PNG or JPEG into straight-alpha BGRA (pdfium splits alpha into an
 * SMask itself). pngjs yields non-premultiplied RGBA; jpeg-js yields RGBA with
 * opaque alpha — a channel swap produces the straight-alpha BGRA upstream got
 * from un-premultiplying nativeImage's bitmap.
 */
export function decodeImageToBgra(bytes: Buffer): DecodedImage {
  if (isPng(bytes)) {
    const dims = pngDims(bytes);
    if (dims && (dims.width > MAX_IMAGE_DIM || dims.height > MAX_IMAGE_DIM)) {
      throw new ImageTooLargeError(dims.width, dims.height);
    }
    const png = PNG.sync.read(bytes);
    if (png.width > MAX_IMAGE_DIM || png.height > MAX_IMAGE_DIM) {
      throw new ImageTooLargeError(png.width, png.height);
    }
    return { width: png.width, height: png.height, bgra: rgbaToBgra(png.data) };
  }
  if (isJpeg(bytes)) {
    const dims = jpegDims(bytes);
    if (dims && (dims.width > MAX_IMAGE_DIM || dims.height > MAX_IMAGE_DIM)) {
      throw new ImageTooLargeError(dims.width, dims.height);
    }
    const raw = jpeg.decode(bytes, { formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    if (raw.width > MAX_IMAGE_DIM || raw.height > MAX_IMAGE_DIM) {
      throw new ImageTooLargeError(raw.width, raw.height);
    }
    return { width: raw.width, height: raw.height, bgra: rgbaToBgra(Buffer.from(raw.data)) };
  }
  throw new Error("unsupported image data (PNG or JPEG required)");
}

/** Scan marker segments for SOF0/SOF2 and read the declared frame dims —
    the same early cap as the PNG path, before jpeg-js allocates. */
function jpegDims(b: Buffer): { width: number; height: number } | null {
  let i = 2; // past SOI
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    // SOF0-15 except DHT(0xC4), JPG(0xC8), DAC(0xCC) carry frame dims
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * Encode a straight-alpha BGRA bitmap as PNG — the swap of
 * `nativeImage.createFromBitmap(bgra, {width, height}).toPNG()` that upstream
 * used for rendered page/region output and image read-back.
 */
export function encodeBgraToPng(bgra: Buffer, width: number, height: number): Buffer {
  const rgba = Buffer.from(bgra);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const b = rgba[i]!;
    rgba[i] = rgba[i + 2]!;
    rgba[i + 2] = b;
  }
  const png = new PNG({ width, height });
  png.data = rgba;
  return PNG.sync.write(png);
}
