// UNI-940 X02: reading a local picture for Insert > Picture. The engine takes
// PNG, JPEG or GIF as base64 (ImageAdd). The type and the natural size come
// from the file header, never the file name: the type names the xl/media part
// the save writes (the server checks the same signature), and the size keeps
// the inserted box's aspect ratio without waiting on an <img> decode.
import { XLSX_VISUAL_IMAGE_TYPES, XLSX_VISUAL_MAX_IMAGE_BYTES, type XlsxVisualImageType } from "@uniwork/office-engine/xlsx";

type XlsxPictureRead =
  | { readonly ok: true; readonly mediaType: XlsxVisualImageType; readonly base64: string; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: "type" | "size" | "unreadable" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The picture type and width/height in pixels from a PNG, GIF or JPEG
 *  header; null when the bytes are none of them. */
export function sniffPicture(bytes: Uint8Array): { mediaType: XlsxVisualImageType; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: signature, then the IHDR chunk's big-endian width/height.
  if (bytes.length >= 24 && PNG_SIGNATURE.every((byte, at) => bytes[at] === byte)) {
    return { mediaType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF: "GIF8", little-endian logical screen size.
  const gifHeader = String.fromCharCode(...bytes.subarray(0, 6));
  if (bytes.length >= 10 && (gifHeader === "GIF87a" || gifHeader === "GIF89a")) {
    return { mediaType: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] ?? 0;
      const length = view.getUint16(at + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { mediaType: "image/jpeg", width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      at += 2 + length;
    }
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

/** The file bytes; FileReader where Blob.arrayBuffer is missing (older
 *  engines, jsdom). */
function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("picture_unreadable"));
    reader.readAsArrayBuffer(file);
  });
}

/** Validate and encode one picked file. */
export async function readPictureFile(file: Blob & { readonly type: string }): Promise<XlsxPictureRead> {
  if (file.size > XLSX_VISUAL_MAX_IMAGE_BYTES) return { ok: false, reason: "size" };
  const bytes = await readBytes(file);
  const picture = sniffPicture(bytes);
  // Bytes of no allowed type: say "type" unless the file claimed one.
  if (!picture) return { ok: false, reason: (XLSX_VISUAL_IMAGE_TYPES as readonly string[]).includes(file.type) ? "unreadable" : "type" };
  if (picture.width <= 0 || picture.height <= 0) return { ok: false, reason: "unreadable" };
  return { ok: true, base64: toBase64(bytes), ...picture };
}

/** Fit a natural size inside `max` pixels on its longer side. */
export function fitPicture(size: { width: number; height: number }, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}
