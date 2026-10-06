import { readImageFile } from "../image/image-insert-panel";
import { MAX_PDF_IMAGE_BYTES } from "../image/provider";

/** The formats the stamp envelope declares. The engine's image operations take
 *  the same two, and the saved-signature store sniffs the same pair. */
export const STAMP_CONTENT_TYPES = ["image/png", "image/jpeg"] as const;
export type PdfStampContentType = (typeof STAMP_CONTENT_TYPES)[number];

export type PdfStampImageFailure = "file_type" | "file_too_large" | "file_unreadable";

export class PdfStampImageError extends Error {
  readonly code: PdfStampImageFailure;

  constructor(code: PdfStampImageFailure, message: string) {
    super(message);
    this.name = "PdfStampImageError";
    this.code = code;
  }
}

export function isStampContentType(value: string): value is PdfStampContentType {
  return (STAMP_CONTENT_TYPES as readonly string[]).includes(value);
}

export interface PreparedStampImage {
  contentType: PdfStampContentType;
  /** Base64 with no `data:` prefix. */
  image: string;
  byteSize: number;
}

/** Reads and encodes a local stamp image. Bounded by the same 48 MiB the image
 *  provider mirrors from the engine's base64 cap, so a stamp that would be
 *  refused after the encode is refused before the request. */
export async function prepareStampImage(file: File): Promise<PreparedStampImage> {
  if (!isStampContentType(file.type)) {
    throw new PdfStampImageError("file_type", "stamp image must be PNG or JPEG");
  }
  if (file.size > MAX_PDF_IMAGE_BYTES) {
    throw new PdfStampImageError("file_too_large", "stamp image exceeds the engine image size cap");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readImageFile(file);
  } catch {
    throw new PdfStampImageError("file_unreadable", "stamp image could not be read");
  }
  if (bytes.length === 0) throw new PdfStampImageError("file_unreadable", "stamp image is empty");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  if (typeof globalThis.btoa !== "function") throw new PdfStampImageError("file_unreadable", "base64 encoder is unavailable");
  return { contentType: file.type, image: globalThis.btoa(binary), byteSize: bytes.length };
}
