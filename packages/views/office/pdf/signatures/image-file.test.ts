import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  formatSignatureByteCap,
  isSavedSignatureContentType,
  MAX_SAVED_SIGNATURE_BYTES,
  PdfSignatureFileError,
  prepareSignatureImage,
  sniffSavedSignatureType,
} from "./image-file";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function fileOf(bytes: Uint8Array, type: string, name = "signature"): File {
  return new File([bytes], name, { type });
}

describe("sniffSavedSignatureType", () => {
  it("recognizes the PNG and JPEG magic numbers the server sniffs", () => {
    expect(sniffSavedSignatureType(PNG)).toBe("image/png");
    expect(sniffSavedSignatureType(JPEG)).toBe("image/jpeg");
  });

  it("answers null for anything else", () => {
    expect(sniffSavedSignatureType(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(sniffSavedSignatureType(Uint8Array.from([]))).toBeNull();
  });
});

describe("prepareSignatureImage", () => {
  it("accepts a PNG and encodes it without a data: prefix", async () => {
    const prepared = await prepareSignatureImage(fileOf(PNG, "image/png"));
    expect(prepared.contentType).toBe("image/png");
    expect(prepared.byteSize).toBe(PNG.length);
    expect(prepared.image).toBe(bytesToBase64(PNG));
    expect(prepared.image.startsWith("data:")).toBe(false);
  });

  it("accepts a JPEG", async () => {
    await expect(prepareSignatureImage(fileOf(JPEG, "image/jpeg"))).resolves.toMatchObject({ contentType: "image/jpeg" });
  });

  it("refuses a type outside the allowlist", async () => {
    await expect(prepareSignatureImage(fileOf(PNG, "image/webp"))).rejects.toMatchObject({ code: "file_type" });
  });

  it("refuses a file over the 512 KiB decoded cap before reading it", async () => {
    const file = fileOf(PNG, "image/png");
    Object.defineProperty(file, "size", { value: MAX_SAVED_SIGNATURE_BYTES + 1 });
    await expect(prepareSignatureImage(file)).rejects.toBeInstanceOf(PdfSignatureFileError);
    await expect(prepareSignatureImage(file)).rejects.toMatchObject({ code: "file_too_large" });
  });

  it("refuses bytes that do not match the declared type", async () => {
    await expect(prepareSignatureImage(fileOf(JPEG, "image/png"))).rejects.toMatchObject({ code: "image_mismatch" });
  });

  it("keeps the cap as copy and in step with the server", () => {
    expect(MAX_SAVED_SIGNATURE_BYTES).toBe(512 * 1024);
    expect(formatSignatureByteCap(MAX_SAVED_SIGNATURE_BYTES)).toBe("512 KiB");
  });

  it("only accepts the two server formats", () => {
    expect(isSavedSignatureContentType("image/png")).toBe(true);
    expect(isSavedSignatureContentType("image/jpeg")).toBe(true);
    expect(isSavedSignatureContentType("image/gif")).toBe(false);
  });
});
