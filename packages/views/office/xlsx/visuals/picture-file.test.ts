import { describe, expect, it } from "vitest";
import { fitPicture, pictureSize, readPictureFile } from "./picture-file";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0xff, 0xd8]);
  // APP0 segment: marker, length 16 (covers the length bytes + 14 payload).
  bytes.set([0xff, 0xe0, 0x00, 0x10], 2);
  // SOF0 right after it, at offset 2 + 2 + 16 = 20.
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  const view = new DataView(bytes.buffer);
  view.setUint16(25, height);
  view.setUint16(27, width);
  return bytes;
}

describe("pictureSize", () => {
  it("reads PNG, GIF and JPEG headers", () => {
    expect(pictureSize(png(300, 200))).toEqual({ width: 300, height: 200 });
    expect(pictureSize(gif(120, 80))).toEqual({ width: 120, height: 80 });
    expect(pictureSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("returns null for unknown or truncated data", () => {
    expect(pictureSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(pictureSize(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(pictureSize(new Uint8Array(0))).toBeNull();
  });
});

describe("readPictureFile", () => {
  it("encodes a valid PNG with its natural size", async () => {
    const bytes = png(300, 200);
    const read = await readPictureFile(new File([bytes], "a.png", { type: "image/png" }));
    expect(read).toEqual({
      ok: true,
      mediaType: "image/png",
      base64: Buffer.from(bytes).toString("base64"),
      width: 300,
      height: 200,
    });
  });

  it("refuses an unsupported media type", async () => {
    expect(await readPictureFile(new File([png(1, 1)], "a.bmp", { type: "image/bmp" }))).toEqual({ ok: false, reason: "type" });
  });

  it("refuses a file above 512 KB", async () => {
    const big = new Uint8Array(512 * 1024 + 1);
    big.set(png(10, 10));
    expect(await readPictureFile(new File([big], "a.png", { type: "image/png" }))).toEqual({ ok: false, reason: "size" });
  });

  it("refuses a picture whose header cannot be read", async () => {
    const garbage = new Uint8Array(64).fill(7);
    expect(await readPictureFile(new File([garbage], "a.png", { type: "image/png" }))).toEqual({ ok: false, reason: "unreadable" });
    expect(await readPictureFile(new File([png(0, 10)], "a.png", { type: "image/png" }))).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("fitPicture", () => {
  it("scales the longer side down to the maximum, keeping the ratio", () => {
    expect(fitPicture({ width: 800, height: 400 }, 400)).toEqual({ width: 400, height: 200 });
    expect(fitPicture({ width: 300, height: 900 }, 300)).toEqual({ width: 100, height: 300 });
  });

  it("never enlarges and never returns zero", () => {
    expect(fitPicture({ width: 50, height: 20 }, 400)).toEqual({ width: 50, height: 20 });
    expect(fitPicture({ width: 1000, height: 1 }, 10)).toEqual({ width: 10, height: 1 });
  });
});
