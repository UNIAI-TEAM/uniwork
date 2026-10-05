import { describe, expect, it } from "vitest";
import { isStampContentType, PdfStampImageError, prepareStampImage, STAMP_CONTENT_TYPES } from "./stamp-image";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

describe("prepareStampImage", () => {
  it("encodes a PNG to base64 without a data: prefix", async () => {
    const prepared = await prepareStampImage(new File([PNG], "stamp.png", { type: "image/png" }));
    expect(prepared.contentType).toBe("image/png");
    expect(prepared.byteSize).toBe(PNG.length);
    expect(prepared.image.startsWith("data:")).toBe(false);
  });

  it("accepts a JPEG", async () => {
    await expect(prepareStampImage(new File([JPEG], "stamp.jpg", { type: "image/jpeg" }))).resolves.toMatchObject({ contentType: "image/jpeg" });
  });

  it("refuses a type outside the allowlist", async () => {
    await expect(prepareStampImage(new File([PNG], "stamp.webp", { type: "image/webp" }))).rejects.toBeInstanceOf(PdfStampImageError);
  });

  it("exposes exactly the two supported formats", () => {
    expect(STAMP_CONTENT_TYPES).toEqual(["image/png", "image/jpeg"]);
    expect(isStampContentType("image/png")).toBe(true);
    expect(isStampContentType("image/svg+xml")).toBe(false);
  });
});
