// UNI-952 (D3-xlsx): header/footer pictures (`&G`), read for print.
// A worksheet names its header/footer drawing in <legacyDrawingHF r:id>; the
// sheet rels resolve it to a VML part whose <v:shape id="LH|CH|RH|LF|CF|RF"
// (+ "EVEN" / "FIRST")> carries the picture's size (style width/height) and an
// <v:imagedata o:relid> the VML rels resolve to an xl/media part.
// The media bytes come through the gateway's optional readEntriesBase64
// (patch 0013, lane L2), which checks sizes before inflating; without it
// every picture is a typed skip. Only PNG, JPEG, GIF and BMP print (Excel's
// EMF/WMF logos are skipped as unsupported). Each picture is capped, and so
// is the whole workbook's header-picture total.
import { decodeXml, elements } from "./render-model-xml.ts";

/** One header/footer picture: a base64 data: URL with the size the VML
 *  shape declares (points), or why it is not printable. */
type XlsxRenderHeaderFooterPicture =
  | { readonly dataUrl: string; readonly widthPt?: number | undefined; readonly heightPt?: number | undefined }
  /** no_reader: the gateway cannot read binary parts; missing: the shape names
   *  no media; unsupported_type: not PNG/JPEG/GIF/BMP; unread: absent, over
   *  the per-picture cap or past the workbook budget. */
  | { readonly skipped: "no_reader" | "missing" | "unsupported_type" | "unread" };

/** Pictures by VML shape id: `LH` `CH` `RH` (odd header), `LF` `CF` `RF`
 *  (odd footer), each also with an `EVEN` or `FIRST` suffix. */
export type XlsxRenderHeaderFooterPictures = Readonly<Record<string, XlsxRenderHeaderFooterPicture>>;

type ReadText = (paths: readonly string[]) => Promise<Readonly<Record<string, string | null>>>;
type XlsxReadBase64 = (paths: readonly string[], maxBytes: number, maxTotalBytes: number) => Promise<Readonly<Record<string, string | null>>>;

/** Per picture and per workbook (decoded bytes). */
export const HF_PICTURE_MAX_BYTES = 1024 * 1024;
export const HF_PICTURES_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const POSITION = /^[LCR][HF](?:EVEN|FIRST)?$/;
const MEDIA_TYPES: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" };

/** VML attributes may be single- or double-quoted. */
function vmlAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? undefined : decodeXml(value);
}

const relsPathOf = (partPath: string): string => {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`;
};

/** A relationship target resolved against the part that owns the rels. */
function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = partPath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

function relTargets(relsXml: string | null | undefined, partPath: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of elements(relsXml ?? "", "Relationship")) {
    const id = vmlAttribute(rel.tag, "Id");
    const target = vmlAttribute(rel.tag, "Target");
    if (id !== undefined && target !== undefined && vmlAttribute(rel.tag, "TargetMode") !== "External") out.set(id, resolveTarget(partPath, target));
  }
  return out;
}

/** A CSS length from a VML style ("96pt", "1.5in", "120px") in points. */
function points(style: string, property: "width" | "height"): number | undefined {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([\\d.]+)\\s*(pt|in|px|cm|mm)?`, "i").exec(style);
  if (!match) return undefined;
  const value = Number(match[1]);
  const factor = { pt: 1, in: 72, px: 0.75, cm: 72 / 2.54, mm: 72 / 25.4 }[(match[2] ?? "pt").toLowerCase() as "pt"] ?? 1;
  return Number.isFinite(value) && value > 0 ? value * factor : undefined;
}

interface HfShape {
  readonly position: string;
  readonly media: string | null;
  readonly widthPt?: number | undefined;
  readonly heightPt?: number | undefined;
}

/** A shared budget across the sheets of one workbook. */
interface XlsxHfPictureBudget {
  remaining: number;
}

/**
 * The header/footer pictures of one worksheet, or undefined when it has no
 * header/footer drawing. Never throws: an unreadable part yields typed skips
 * (or nothing when even the drawing cannot be found).
 */
async function readHeaderFooterPictures(
  sheetPath: string,
  sheetXml: string,
  readText: ReadText,
  readBase64: XlsxReadBase64 | undefined,
  budget: XlsxHfPictureBudget,
): Promise<XlsxRenderHeaderFooterPictures | undefined> {
  const drawing = elements(sheetXml, "legacyDrawingHF")[0];
  const relId = drawing ? (vmlAttribute(drawing.tag, "r:id") ?? vmlAttribute(drawing.tag, "id")) : undefined;
  if (relId === undefined) return undefined;
  try {
    const sheetRels = await readText([relsPathOf(sheetPath)]);
    const vmlPath = relTargets(sheetRels[relsPathOf(sheetPath)], sheetPath).get(relId);
    if (!vmlPath) return undefined;
    const parts = await readText([vmlPath, relsPathOf(vmlPath)]);
    const vml = parts[vmlPath];
    if (!vml) return undefined;
    const media = relTargets(parts[relsPathOf(vmlPath)], vmlPath);
    const shapes: HfShape[] = [];
    for (const shape of elements(vml, "shape")) {
      const position = vmlAttribute(shape.tag, "id");
      if (position === undefined || !POSITION.test(position)) continue;
      const imageData = elements(shape.body, "imagedata")[0];
      const mediaRel = imageData ? (vmlAttribute(imageData.tag, "o:relid") ?? vmlAttribute(imageData.tag, "r:id")) : undefined;
      const style = vmlAttribute(shape.tag, "style") ?? "";
      shapes.push({ position, media: mediaRel === undefined ? null : (media.get(mediaRel) ?? null), widthPt: points(style, "width"), heightPt: points(style, "height") });
    }
    if (shapes.length === 0) return undefined;

    const out: Record<string, XlsxRenderHeaderFooterPicture> = {};
    const wanted: string[] = [];
    for (const shape of shapes) {
      const type = shape.media ? MEDIA_TYPES[shape.media.slice(shape.media.lastIndexOf(".") + 1).toLowerCase()] : undefined;
      if (!shape.media) out[shape.position] = { skipped: "missing" };
      else if (!type) out[shape.position] = { skipped: "unsupported_type" };
      else if (!readBase64) out[shape.position] = { skipped: "no_reader" };
      else wanted.push(shape.media);
    }
    const unique = [...new Set(wanted)];
    const read = unique.length > 0 && readBase64 && budget.remaining > 0
      ? await readBase64(unique, HF_PICTURE_MAX_BYTES, budget.remaining)
      : {};
    for (const path of unique) {
      const base64 = read[path];
      if (base64) budget.remaining -= Math.floor((base64.length * 3) / 4);
    }
    for (const shape of shapes) {
      if (out[shape.position] || !shape.media) continue;
      const base64 = read[shape.media]?.replace(/\s+/g, "");
      if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        out[shape.position] = { skipped: "unread" };
        continue;
      }
      const type = MEDIA_TYPES[shape.media.slice(shape.media.lastIndexOf(".") + 1).toLowerCase()]!;
      out[shape.position] = {
        dataUrl: `data:${type};base64,${base64}`,
        ...(shape.widthPt === undefined ? {} : { widthPt: shape.widthPt }),
        ...(shape.heightPt === undefined ? {} : { heightPt: shape.heightPt }),
      };
    }
    return out;
  } catch {
    return undefined;
  }
}

/** The engine's optional binary read (lane L2, patch 0013), when bound. */
interface XlsxBase64Engine {
  readEntriesBase64?(bytes: Uint8Array, paths: readonly string[], maxBytes: number, maxTotalBytes: number): Promise<Readonly<Record<string, string | null>>>;
}

/** Every sheet's header/footer pictures (index-aligned, undefined = none),
 *  under one workbook budget. */
export async function readWorkbookHeaderFooterPictures(
  sheets: readonly { readonly path?: string | undefined }[],
  sheetXmls: Readonly<Record<string, string | null>>,
  readText: ReadText,
  gateway: object,
  bytes: Uint8Array,
): Promise<(XlsxRenderHeaderFooterPictures | undefined)[]> {
  // The gateway type does not declare the optional read (it exists only once
  // lane L2's patch is bound), so it is checked structurally here.
  const engine = gateway as XlsxBase64Engine;
  const readBase64: XlsxReadBase64 | undefined = typeof engine.readEntriesBase64 === "function"
    ? (paths, maxBytes, maxTotalBytes) => engine.readEntriesBase64!(bytes, paths, maxBytes, maxTotalBytes)
    : undefined;
  const budget: XlsxHfPictureBudget = { remaining: HF_PICTURES_MAX_TOTAL_BYTES };
  const out: (XlsxRenderHeaderFooterPictures | undefined)[] = [];
  for (const sheet of sheets) {
    const xml = sheet.path ? sheetXmls[sheet.path] : null;
    out.push(sheet.path && xml ? await readHeaderFooterPictures(sheet.path, xml, readText, readBase64, budget) : undefined);
  }
  return out;
}
