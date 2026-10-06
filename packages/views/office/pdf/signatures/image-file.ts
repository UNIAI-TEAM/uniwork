import { readImageFile } from "../image/image-insert-panel";

/** Mirrors `service.MaxSignatureBytes` (512 KiB) and the migration's CHECK:
 *  the server refuses a bigger decoded image, so the picker refuses it before
 *  the request instead of surfacing a 400. Keep the two in step. */
export const MAX_SAVED_SIGNATURE_BYTES = 512 * 1024;

/** The only formats the server sniffs and stores (`signatureContentTypes`). */
export const SAVED_SIGNATURE_CONTENT_TYPES = ["image/png", "image/jpeg"] as const;
export type SavedSignatureContentType = (typeof SAVED_SIGNATURE_CONTENT_TYPES)[number];

export type PdfSignatureFileFailure = "file_type" | "file_too_large" | "file_unreadable" | "image_mismatch";

export class PdfSignatureFileError extends Error {
  readonly code: PdfSignatureFileFailure;

  constructor(code: PdfSignatureFileFailure, message: string) {
    super(message);
    this.name = "PdfSignatureFileError";
    this.code = code;
  }
}

export function isSavedSignatureContentType(value: string): value is SavedSignatureContentType {
  return (SAVED_SIGNATURE_CONTENT_TYPES as readonly string[]).includes(value);
}

/** `http.DetectContentType`'s PNG/JPEG answer, checked on the bytes rather than
 *  on the browser's `File.type`, which the user's OS supplies and can be wrong.
 *  The server sniffs the same way and rejects a mismatch, so a file that lies
 *  about its type fails here with a local sentence instead of a round trip. */
export function sniffSavedSignatureType(bytes: Uint8Array): SavedSignatureContentType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Base64 without a `data:` prefix — the wire shape the endpoint expects. */
export function bytesToBase64(bytes: Uint8Array): string {
  const encode = globalThis.btoa;
  if (typeof encode !== "function") throw new PdfSignatureFileError("file_unreadable", "base64 encoder is unavailable");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return encode(binary);
}

export interface PreparedSignatureImage {
  contentType: SavedSignatureContentType;
  /** Image bytes base64-encoded, without the `data:` prefix. */
  image: string;
  byteSize: number;
}

/** Validates a local file the way the server will, then encodes it. Throws a
 *  typed `PdfSignatureFileError` so the picker can localize each failure. */
export async function prepareSignatureImage(file: File): Promise<PreparedSignatureImage> {
  const contentType = file.type;
  if (!isSavedSignatureContentType(contentType)) {
    throw new PdfSignatureFileError("file_type", "signature image must be PNG or JPEG");
  }
  if (file.size > MAX_SAVED_SIGNATURE_BYTES) {
    throw new PdfSignatureFileError("file_too_large", "signature image exceeds the decoded size cap");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readImageFile(file);
  } catch {
    throw new PdfSignatureFileError("file_unreadable", "signature image could not be read");
  }
  if (bytes.length === 0) throw new PdfSignatureFileError("file_unreadable", "signature image is empty");
  if (bytes.length > MAX_SAVED_SIGNATURE_BYTES) {
    throw new PdfSignatureFileError("file_too_large", "signature image exceeds the decoded size cap");
  }
  if (sniffSavedSignatureType(bytes) !== contentType) {
    throw new PdfSignatureFileError("image_mismatch", "signature bytes do not match the declared type");
  }
  return { contentType, image: bytesToBase64(bytes), byteSize: bytes.length };
}

/** The cap as copy, so the sentence cannot drift from the constant. */
export function formatSignatureByteCap(bytes: number): string {
  return `${Math.round(bytes / 1024)} KiB`;
}
