import { describe, expect, it } from "vitest";
import { PHOTO_MAX_SIDE, photoResize, photoSaveFormat } from "./photo-size";

describe("photoResize", () => {
  it("brings the longer side down to the cap, keeping the ratio", () => {
    expect(photoResize(4032, 3024)).toEqual({ width: PHOTO_MAX_SIDE });
    expect(photoResize(3024, 4032)).toEqual({ height: PHOTO_MAX_SIDE });
    expect(photoResize(3000, 3000)).toEqual({ width: PHOTO_MAX_SIDE });
  });

  it("leaves a photo already within the cap, or of unknown size, as it is", () => {
    expect(photoResize(PHOTO_MAX_SIDE, 1000)).toBeNull();
    expect(photoResize(1080, 1920)).toBeNull();
    expect(photoResize(0, 0)).toBeNull();
    expect(photoResize(undefined, 4000)).toBeNull();
  });
});

describe("photoSaveFormat", () => {
  it("re-encodes JPEG and PNG in their own format and nothing else", () => {
    expect(photoSaveFormat("image/jpeg")).toBe("jpeg");
    expect(photoSaveFormat("IMAGE/JPG")).toBe("jpeg");
    expect(photoSaveFormat("image/png")).toBe("png");
    // An animated GIF would lose its frames; a WebP or HEIC is left to the server's own rules.
    expect(photoSaveFormat("image/gif")).toBeNull();
    expect(photoSaveFormat("image/webp")).toBeNull();
    expect(photoSaveFormat(undefined)).toBeNull();
  });
});
