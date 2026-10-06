// UNI-952 (fix-E2-docx): header/footer pictures in the DOCX print copy.
//
// Chromium prints a `content: url(data:...)` image inside an @page margin box
// at its intrinsic pixel size, and `image-set(url(...) Nx)` scales it (checked
// against headless Chromium's PDF output). The part's display size
// (widthPx/heightPx) is therefore turned into a resolution: the decoded
// picture's natural width divided by the width the part asks for. Only raster
// base64 data: URLs are accepted, so the copy's CSP (img-src data:) holds and
// nothing in the URL can leave the CSS string it is written into.

const RASTER_DATA_URL = /^data:image\/(png|jpe?g|gif|bmp|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;
/** Enough of a JPEG to reach its frame header behind typical EXIF/ICC segments. */
const JPEG_SCAN_CHARS = 262144;

export interface DocxPrintHfImage {
  /** A raster base64 `data:image/...` URL (validated). */
  dataUrl: string;
  /** Display size in CSS px, when the part records one. */
  widthPx?: number;
  heightPx?: number;
  align: "left" | "center" | "right";
}

interface PixelSize {
  width: number;
  height: number;
}

function decodeBase64(base64: string, maxChars: number): Uint8Array | null {
  const slice = base64.slice(0, Math.floor(Math.min(base64.length, maxChars) / 4) * 4);
  try {
    const binary = atob(slice);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const be16 = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const le16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const be32 = (b: Uint8Array, at: number): number => be16(b, at) * 65536 + be16(b, at + 2);
const le32 = (b: Uint8Array, at: number): number => le16(b, at) + le16(b, at + 2) * 65536;

function jpegSize(b: Uint8Array): PixelSize | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;
    // SOF0..SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: be16(b, at + 5), width: be16(b, at + 7) };
    }
    at += 2 + be16(b, at + 2);
  }
  return null;
}

/** The picture's natural pixel size from its header; null when it cannot be read. */
function naturalSize(kind: string, base64: string): PixelSize | null {
  const bytes = decodeBase64(base64, kind === "jpeg" || kind === "jpg" ? JPEG_SCAN_CHARS : 64);
  if (!bytes) return null;
  let size: PixelSize | null = null;
  if (kind === "png" && bytes.length >= 24) size = { width: be32(bytes, 16), height: be32(bytes, 20) };
  else if (kind === "gif" && bytes.length >= 10) size = { width: le16(bytes, 6), height: le16(bytes, 8) };
  else if (kind === "bmp" && bytes.length >= 26) size = { width: le32(bytes, 18), height: Math.abs(le32(bytes, 22) | 0) };
  else if ((kind === "jpeg" || kind === "jpg") && bytes[0] === 0xff && bytes[1] === 0xd8) size = jpegSize(bytes);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const alignOf = (value: unknown): DocxPrintHfImage["align"] | undefined =>
  value === "left" || value === "center" || value === "right" ? value : undefined;

/**
 * The printable pictures of a parsed header/footer part (engine HfImage):
 * raster data: URLs only. Watermarks, behind-text pictures and WordArt are
 * page decoration, not header content, and are left out.
 */
export function printableHfImages(images: readonly unknown[] | null | undefined): DocxPrintHfImage[] {
  const out: DocxPrintHfImage[] = [];
  for (const raw of images ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const image = raw as Record<string, unknown>;
    if (image.watermark === true || image.behind === true || image.wordArt) continue;
    const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl.replace(/\s+/g, "") : "";
    if (!RASTER_DATA_URL.test(dataUrl)) continue;
    const widthPx = positive(image.widthPx);
    const heightPx = positive(image.heightPx);
    out.push({
      dataUrl,
      ...(widthPx !== undefined ? { widthPx } : {}),
      ...(heightPx !== undefined ? { heightPx } : {}),
      align: alignOf(image.align) ?? alignOf(image.posH) ?? "left",
    });
  }
  return out;
}

/** The CSS `content` value for one picture: `image-set(...)` at the part's width, else the plain URL. */
export function hfImageContent(image: DocxPrintHfImage): string {
  const match = RASTER_DATA_URL.exec(image.dataUrl);
  if (!match) return "";
  const url = `url("${image.dataUrl}")`;
  const natural = naturalSize((match[1] ?? "").toLowerCase(), match[2] ?? "");
  const scale = natural && image.widthPx ? natural.width / image.widthPx : natural && image.heightPx ? natural.height / image.heightPx : null;
  if (scale === null || !Number.isFinite(scale) || scale <= 0) return url;
  const resolution = Math.min(100, Math.max(0.01, Number(scale.toFixed(4))));
  return resolution === 1 ? url : `image-set(${url} ${resolution}x)`;
}
