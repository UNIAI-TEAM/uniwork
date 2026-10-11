// Direct tests of the pure-JS image codec seam: PNG/JPEG decode into
// straight-alpha BGRA, the dimension cap, bad bytes, and the PNG encoder.
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { decodeImageToBgra, encodeBgraToPng, ImageTooLargeError } from "./codec";

/** RGBA PNG built with pngjs directly, independent of encodeBgraToPng. */
function rgbaPng(width: number, height: number, pixel: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) png.data.set(pixel, i * 4);
  return PNG.sync.write(png);
}

function solidJpeg(width: number, height: number, rgb: [number, number, number]): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return Buffer.from(jpeg.encode({ data, width, height }, 95).data);
}

describe("decodeImageToBgra", () => {
  it("decodes a PNG into straight-alpha BGRA with red and blue swapped", () => {
    const decoded = decodeImageToBgra(rgbaPng(3, 2, [200, 100, 50, 128]));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect(decoded.bgra.length).toBe(3 * 2 * 4);
    // RGBA (200,100,50,128) becomes BGRA (50,100,200,128); alpha is not premultiplied.
    expect([...decoded.bgra.subarray(0, 4)]).toEqual([50, 100, 200, 128]);
    expect([...decoded.bgra.subarray(20, 24)]).toEqual([50, 100, 200, 128]);
  });

  it("decodes a JPEG into opaque BGRA close to the source colour", () => {
    const decoded = decodeImageToBgra(solidJpeg(16, 16, [250, 20, 20]));
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);
    const [b, g, r, a] = [...decoded.bgra.subarray(0, 4)];
    expect(a).toBe(255);
    expect(r!).toBeGreaterThan(200);
    expect(b!).toBeLessThan(80);
    expect(g!).toBeLessThan(80);
  });

  it("refuses bytes that are neither PNG nor JPEG", () => {
    expect(() => decodeImageToBgra(Buffer.from("GIF89a not supported"))).toThrow(
      "unsupported image data (PNG or JPEG required)",
    );
    expect(() => decodeImageToBgra(Buffer.alloc(0))).toThrow("unsupported image data");
  });

  it("refuses a PNG whose header declares more than the dimension cap, before decoding it", () => {
    const wide = rgbaPng(8193, 1, [1, 2, 3, 255]);
    let error: unknown;
    try {
      decodeImageToBgra(wide);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ImageTooLargeError);
    expect((error as Error).name).toBe("ImageTooLargeError");
    expect((error as Error).message).toContain("image_too_large: 8193x1px");
  });

  it("refuses a tiny PNG header that declares a huge frame without allocating it", () => {
    const header = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(60_000, 16);
    header.writeUInt32BE(60_000, 20);
    expect(() => decodeImageToBgra(header)).toThrow(ImageTooLargeError);
  });

  it("accepts a PNG exactly at the dimension cap", () => {
    const decoded = decodeImageToBgra(rgbaPng(8192, 1, [0, 0, 0, 255]));
    expect(decoded.width).toBe(8192);
  });

  it("falls through to the PNG decoder when the header is truncated, which then fails", () => {
    const truncated = rgbaPng(2, 2, [1, 2, 3, 255]).subarray(0, 20);
    expect(() => decodeImageToBgra(truncated)).toThrow();
  });

  it("refuses a JPEG whose SOF segment declares more than the dimension cap", () => {
    const wide = solidJpeg(8193, 1, [10, 10, 10]);
    expect(() => decodeImageToBgra(wide)).toThrow(ImageTooLargeError);
  });

  it("refuses a hand-built JPEG header that declares a huge frame", () => {
    const b = Buffer.alloc(32);
    b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
    b.writeUInt16BE(20_000, 7); // height
    b.writeUInt16BE(20_000, 9); // width
    // jpegDims reads height at i+5 and width at i+7 from the SOF marker at i=2.
    expect(() => decodeImageToBgra(b)).toThrow(ImageTooLargeError);
  });

  it("skips non-SOF marker segments and standalone markers while scanning for the frame size", () => {
    const real = solidJpeg(8, 8, [30, 60, 90]);
    // Insert a COM segment and a standalone RST marker after SOI; the scan must walk over both.
    const com = Buffer.from([0xff, 0xfe, 0x00, 0x04, 0x41, 0x42]);
    const rst = Buffer.from([0xff, 0xd0]);
    const withExtra = Buffer.concat([real.subarray(0, 2), rst, com, real.subarray(2)]);
    // The header scan finds the real SOF and finds it small; decode may then reject the odd
    // stream, but it must never report the size cap.
    try {
      const decoded = decodeImageToBgra(withExtra);
      expect(decoded.width).toBe(8);
    } catch (e) {
      expect(e).not.toBeInstanceOf(ImageTooLargeError);
    }
  });

  it("does not report the size cap when the marker walk finds no frame header", () => {
    const b = Buffer.alloc(24, 0x11);
    b.set([0xff, 0xd8, 0xff]);
    let error: unknown;
    try {
      decodeImageToBgra(b);
    } catch (e) {
      error = e;
    }
    // jpegDims bails out on the non-marker byte, so the failure comes from the decoder itself.
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ImageTooLargeError);
  });

  it("stops the marker walk on a zero-length segment instead of looping", () => {
    const b = Buffer.alloc(24);
    b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
    expect(() => decodeImageToBgra(b)).toThrow();
  });
});

describe("encodeBgraToPng", () => {
  it("round-trips BGRA pixels through PNG, restoring channel order and alpha", () => {
    const bgra = Buffer.from([
      1, 2, 3, 255, //
      10, 20, 30, 128,
      40, 50, 60, 0,
      70, 80, 90, 255,
    ]);
    const original = Buffer.from(bgra);
    const png = encodeBgraToPng(bgra, 2, 2);
    // The caller's buffer is not swapped in place.
    expect(bgra.equals(original)).toBe(true);
    const parsed = PNG.sync.read(png);
    expect(parsed.width).toBe(2);
    expect(parsed.height).toBe(2);
    expect([...parsed.data.subarray(0, 4)]).toEqual([3, 2, 1, 255]);
    expect([...parsed.data.subarray(4, 8)]).toEqual([30, 20, 10, 128]);
    const back = decodeImageToBgra(png);
    expect([...back.bgra.subarray(0, 4)]).toEqual([1, 2, 3, 255]);
    expect([...back.bgra.subarray(12, 16)]).toEqual([70, 80, 90, 255]);
  });
});
