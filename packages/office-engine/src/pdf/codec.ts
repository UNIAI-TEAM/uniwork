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

/**
 * Decode a PNG or JPEG into straight-alpha BGRA (pdfium splits alpha into an
 * SMask itself). pngjs yields non-premultiplied RGBA; jpeg-js yields RGBA with
 * opaque alpha — a channel swap produces the straight-alpha BGRA upstream got
 * from un-premultiplying nativeImage's bitmap.
 */
export function decodeImageToBgra(bytes: Buffer): DecodedImage {
  if (isPng(bytes)) {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, bgra: rgbaToBgra(png.data) };
  }
  if (isJpeg(bytes)) {
    const raw = jpeg.decode(bytes, { formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { width: raw.width, height: raw.height, bgra: rgbaToBgra(Buffer.from(raw.data)) };
  }
  throw new Error("unsupported image data (PNG or JPEG required)");
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
