// Image and visual-signature stamps. The B6 UI sends one `addStamp` op per
// placed stamp; both kinds take the same drawing path — a stamped image is a
// plain image XObject in the target page's content stream, so no annotation,
// form field or appearance stream is invented and older readers are unaffected.
import { degrees } from "pdf-lib";
import type { PDFDocument, PDFImage } from "pdf-lib";
import { PdfOpError } from "./op-parse.ts";
import type { QuarterTurns, StampInput } from "./types.ts";

/** Right-angle turns only; a stamp is never drawn at an arbitrary angle. */
const QUARTER_TURNS: readonly number[] = [0, 90, 180, 270];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function refuse(field: string, message: string): never {
  throw new PdfOpError("addStamp", field, message);
}

/**
 * Decode a stamp's base64 payload, refusing anything Buffer would silently
 * salvage. The content-type magic is checked too, because pdf-lib's embed path
 * throws a bare Error for bytes that are not really that format — a typed
 * refusal here keeps a broken payload out of the job's crash path.
 */
function decodeStampImage(contentType: string, image: string): Buffer {
  if (typeof image !== "string" || image.length === 0) {
    refuse("image", "image must be a non-empty base64 string");
  }
  if (image.startsWith("data:")) {
    refuse("image", "image must be raw base64 without a data: prefix");
  }
  const compact = image.replace(/\s+/g, "");
  if (compact.length === 0 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    refuse("image", "image is not valid base64");
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0) refuse("image", "image base64 decodes to zero bytes");
  const magic = contentType === "image/png" ? PNG_MAGIC : JPEG_MAGIC;
  if (!bytes.subarray(0, magic.length).equals(magic)) {
    refuse("image", `image bytes are not a ${contentType} payload`);
  }
  return bytes;
}

/**
 * Validate a stamp payload before anything is drawn. Returns the decoded bytes
 * so the caller embeds exactly once; every failure is a typed refusal rather
 * than a silent drop, because a missing stamp is a missing signature.
 */
function validateStamp(doc: PDFDocument, stamp: StampInput): Buffer {
  if (stamp.kind !== "image" && stamp.kind !== "signature") {
    refuse("kind", `unknown stamp kind: ${String(stamp.kind)}`);
  }
  if (stamp.contentType !== "image/png" && stamp.contentType !== "image/jpeg") {
    refuse("contentType", `unsupported stamp content type: ${String(stamp.contentType)}`);
  }
  const { rect } = stamp;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((n) => typeof n === "number" && Number.isFinite(n))) {
    refuse("rect", "rect must be a 4-tuple [x1, y1, x2, y2]");
  }
  if (rect[2] - rect[0] <= 0 || rect[3] - rect[1] <= 0) {
    refuse("rect", "rect must have positive width and height");
  }
  const turns = stamp.quarterTurns ?? 0;
  if (!QUARTER_TURNS.includes(turns)) {
    refuse("quarterTurns", `quarterTurns must be one of 0/90/180/270, got ${String(turns)}`);
  }
  if (!Number.isInteger(stamp.pageIndex)) {
    refuse("pageIndex", `pageIndex must be an integer, got ${String(stamp.pageIndex)}`);
  }
  if (stamp.pageIndex < 0 || stamp.pageIndex >= doc.getPageCount()) {
    refuse("pageIndex", `pageIndex ${stamp.pageIndex} is out of range`);
  }
  return decodeStampImage(stamp.contentType, stamp.image);
}

/**
 * Draw an image or signature stamp onto its target page at `rect`, rotated by
 * `quarterTurns`. Only the target page's content stream is touched; the caller
 * owns saving. `kind: "signature"` follows the same path — `signatureId` is
 * validated and carried on the parsed op (so a caller can audit it) but
 * deliberately not persisted: the stamp stays a plain image, and the saved file
 * keeps its original annotation and form semantics.
 */
async function embedStamp(doc: PDFDocument, stamp: StampInput, bytes: Buffer): Promise<PDFImage> {
  try {
    return stamp.contentType === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    // Magic bytes matched but the payload is still unusable (truncated file).
    return refuse("image", `image bytes could not be embedded as ${stamp.contentType}`);
  }
}

export async function applyStamp(doc: PDFDocument, stamp: StampInput): Promise<void> {
  const bytes = validateStamp(doc, stamp);
  const page = doc.getPage(stamp.pageIndex);
  const image = await embedStamp(doc, stamp, bytes);
  const [x1, y1, x2, y2] = stamp.rect;
  page.drawImage(image, {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    rotate: degrees(stamp.quarterTurns ?? 0),
  });
}

/** Parse a `quarterTurns` field, narrowing the number to the allowed literals. */
export function parseQuarterTurns(v: unknown, op: string, f: string): QuarterTurns | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || !QUARTER_TURNS.includes(v)) {
    throw new PdfOpError(op, f, "0|90|180|270");
  }
  return v as QuarterTurns;
}
