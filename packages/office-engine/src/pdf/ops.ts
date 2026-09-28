// Envelope edits[] → PdfEditRequest. Each item is {op, target, text,
// attributes}; the op names are upstream's canonical ones (op-docs.ts). A
// malformed item is a typed PdfOpError, never a silent drop — the caller's
// ops either all parse or the job fails before any byte is touched.
import type {
  AnnotDeleteInput,
  ImageEditInput,
  ImageLayer,
  MetadataInput,
  PdfEditRequest,
  TextEditInput,
  TextInsertInput,
} from "./types.ts";

export class PdfOpError extends Error {
  readonly opName: string;
  readonly field: string;
  constructor(opName: string, field: string, message: string) {
    super(`${opName}.${field}: ${message}`);
    this.name = "PdfOpError";
    this.opName = opName;
    this.field = field;
  }
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function num(v: unknown, op: string, f: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new PdfOpError(op, f, "number required");
  return v;
}
function int(v: unknown, op: string, f: string): number {
  const n = num(v, op, f);
  if (!Number.isSafeInteger(n)) throw new PdfOpError(op, f, "integer required");
  return n;
}
function str(v: unknown, op: string, f: string): string {
  if (typeof v !== "string") throw new PdfOpError(op, f, "string required");
  return v;
}
function bool(v: unknown, op: string, f: string): boolean {
  if (typeof v !== "boolean") throw new PdfOpError(op, f, "boolean required");
  return v;
}
function vec4(v: unknown, op: string, f: string): [number, number, number, number] {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new PdfOpError(op, f, "[x1,y1,x2,y2] number tuple required");
  }
  return [v[0], v[1], v[2], v[3]] as [number, number, number, number];
}
function vec2(v: unknown, op: string, f: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new PdfOpError(op, f, "[x,y] number tuple required");
  }
  return [v[0], v[1]] as [number, number];
}
function rgb255(v: unknown, op: string, f: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new PdfOpError(op, f, "[r,g,b] 0-255 tuple required");
  }
  return [v[0], v[1], v[2]] as [number, number, number];
}
function opt<T>(v: unknown, parse: (v: unknown, op: string, f: string) => T, op: string, f: string): T | undefined {
  return v === undefined ? undefined : parse(v, op, f);
}
function attrsOf(item: Dict): Dict {
  const merged: Dict = {};
  if (isDict(item.target)) Object.assign(merged, item.target);
  if (isDict(item.attributes)) Object.assign(merged, item.attributes);
  // Convenience wire fields ride at the top level when the caller put them there.
  for (const k of ["text", "style", "range"]) {
    if (item[k] !== undefined && merged[k] === undefined) merged[k] = item[k];
  }
  return merged;
}

const MARKUP_SUBTYPES = new Set(["highlight", "underline", "strikeout", "note"]);

function parseAnnotDelete(a: Dict, op: string): AnnotDeleteInput {
  const subtype = str(a.subtype, op, "subtype") as AnnotDeleteInput["subtype"];
  if (!MARKUP_SUBTYPES.has(subtype)) throw new PdfOpError(op, "subtype", "unknown subtype");
  return {
    pageIndex: int(a.pageIndex, op, "pageIndex"),
    objNum: int(a.objNum, op, "objNum"),
    subtype,
    rect: vec4(a.rect, op, "rect"),
    contents: opt(a.contents, str, op, "contents"),
  };
}

function parseTextEdit(a: Dict, op: string): TextEditInput {
  return {
    pageIndex: int(a.pageIndex, op, "pageIndex"),
    rect: vec4(a.rect, op, "rect"),
    oldText: str(a.oldText, op, "oldText"),
    newText: str(a.newText, op, "newText"),
    fontSize: num(a.fontSize, op, "fontSize"),
    newFontSize: opt(a.newFontSize, num, op, "newFontSize"),
    newColor: opt(a.newColor, rgb255, op, "newColor"),
    colorRuns: opt(a.colorRuns, (v, o, f) => {
      if (!Array.isArray(v)) throw new PdfOpError(o, f, "array required");
      return v.map((r) => {
        if (!isDict(r)) throw new PdfOpError(o, f, "range objects required");
        return {
          start: int(r.start, o, f + ".start"),
          end: int(r.end, o, f + ".end"),
          color: rgb255(r.color, o, f + ".color"),
        };
      });
    }, op, "colorRuns"),
    styleRuns: opt(a.styleRuns, (v, o, f) => {
      if (!Array.isArray(v)) throw new PdfOpError(o, f, "array required");
      return v.map((r) => {
        if (!isDict(r)) throw new PdfOpError(o, f, "run objects required");
        return {
          start: int(r.start, o, f + ".start"),
          end: int(r.end, o, f + ".end"),
          color: opt(r.color, rgb255, o, f + ".color"),
          font: opt(r.font, str, o, f + ".font"),
          size: opt(r.size, num, o, f + ".size"),
          bold: opt(r.bold, bool, o, f + ".bold"),
          italic: opt(r.italic, bool, o, f + ".italic"),
        };
      });
    }, op, "styleRuns"),
    newFont: opt(a.newFont, str, op, "newFont"),
    origin: opt(a.origin, vec2, op, "origin"),
    lineLeading: opt(a.lineLeading, num, op, "lineLeading"),
    lineXOffsets: opt(a.lineXOffsets, (v, o, f) => {
      if (!Array.isArray(v)) throw new PdfOpError(o, f, "array required");
      return v.map((n) => num(n, o, f));
    }, op, "lineXOffsets"),
    align: opt(a.align, (v, o, f) => {
      const s = str(v, o, f);
      if (s !== "left" && s !== "center" && s !== "right") throw new PdfOpError(o, f, "left|center|right");
      return s;
    }, op, "align"),
    newBold: opt(a.newBold, bool, op, "newBold"),
    newItalic: opt(a.newItalic, bool, op, "newItalic"),
    translate: opt(a.translate, vec2, op, "translate"),
  };
}

function parseTextInsert(a: Dict, op: string): TextInsertInput {
  return {
    pageIndex: int(a.pageIndex, op, "pageIndex"),
    origin: vec2(a.origin, op, "origin"),
    text: str(a.text, op, "text"),
    fontSize: num(a.fontSize, op, "fontSize"),
    color: rgb255(a.color, op, "color"),
    font: opt(a.font, str, op, "font"),
    bold: opt(a.bold, bool, op, "bold"),
    italic: opt(a.italic, bool, op, "italic"),
    lineLeading: opt(a.lineLeading, num, op, "lineLeading"),
    lineXOffsets: opt(a.lineXOffsets, (v, o, f) => {
      if (!Array.isArray(v)) throw new PdfOpError(o, f, "array required");
      return v.map((n) => num(n, o, f));
    }, op, "lineXOffsets"),
    align: opt(a.align, (v, o, f) => {
      const s = str(v, o, f);
      if (s !== "left" && s !== "center" && s !== "right") throw new PdfOpError(o, f, "left|center|right");
      return s;
    }, op, "align"),
    rotate: opt(a.rotate, num, op, "rotate"),
  };
}

const IMAGE_LAYERS = new Set<ImageLayer>(["belowText", "aboveText"]);
const layer = (v: unknown, op: string, f: string): ImageLayer => {
  const s = str(v, op, f) as ImageLayer;
  if (!IMAGE_LAYERS.has(s)) throw new PdfOpError(op, f, "belowText|aboveText");
  return s;
};

function parseImageEdit(a: Dict, op: string): ImageEditInput {
  const kind = str(a.kind, op, "kind");
  const base = { pageIndex: int(a.pageIndex, op, "pageIndex") };
  switch (kind) {
    case "insertImage":
      return {
        ...base,
        kind,
        image: str(a.image, op, "image"),
        rect: vec4(a.rect, op, "rect"),
        layer: layer(a.layer, op, "layer"),
        rotate: opt(a.rotate, num, op, "rotate"),
      };
    case "transformImage":
      return {
        ...base,
        kind,
        oldRect: vec4(a.oldRect, op, "oldRect"),
        rect: vec4(a.rect, op, "rect"),
        layer: opt(a.layer, layer, op, "layer"),
        quarterTurns: opt(a.quarterTurns, int, op, "quarterTurns"),
      };
    case "replaceImage":
      return {
        ...base,
        kind,
        oldRect: vec4(a.oldRect, op, "oldRect"),
        rect: vec4(a.rect, op, "rect"),
        image: str(a.image, op, "image"),
        layer: opt(a.layer, layer, op, "layer"),
        quarterTurns: opt(a.quarterTurns, int, op, "quarterTurns"),
      };
    case "deleteImage":
      return { ...base, kind, oldRect: vec4(a.oldRect, op, "oldRect") };
    default:
      throw new PdfOpError(op, "kind", "insertImage|transformImage|replaceImage|deleteImage");
  }
}

function parseMetadata(a: Dict, op: string): MetadataInput {
  return {
    title: opt(a.title, str, op, "title"),
    author: opt(a.author, str, op, "author"),
    subject: opt(a.subject, str, op, "subject"),
    keywords: opt(a.keywords, str, op, "keywords"),
  };
}

/**
 * Fold a validated envelope edits array into the engine's PdfEditRequest.
 * Unknown op names are a typed error (the caller learns the vocabulary is
 * narrower than upstream's, not that its op vanished).
 */
export function parsePdfOps(edits: unknown[]): PdfEditRequest {
  const req: PdfEditRequest = {};
  const push = <K extends keyof PdfEditRequest>(
    key: K,
    value: NonNullable<PdfEditRequest[K]> extends Array<infer T> ? T : never,
  ) => {
    (req as Dict)[key] = [...(((req as Dict)[key] as unknown[]) ?? []), value];
  };
  for (const item of edits) {
    if (!isDict(item)) throw new PdfOpError("<item>", "", "object required");
    const op = str(item.op, "<item>", "op");
    const a = attrsOf(item);
    switch (op) {
      case "putTextEdit":
        push("textEdits", parseTextEdit(a, op));
        break;
      case "addTextInsert":
        push("textInserts", parseTextInsert(a, op));
        break;
      case "addImageEdit":
        push("imageEdits", parseImageEdit(a, op));
        break;
      case "deleteSavedAnnot":
        // upstream shape: {annot:{pageIndex,objNum,type,rect,...}}
        push("annotDeletes", parseAnnotDelete(isDict(a.annot) ? a.annot : a, op));
        break;
      case "rotatePages": {
        const pages = a.pages;
        if (!Array.isArray(pages)) throw new PdfOpError(op, "pages", "array required");
        const dir = int(a.dir, op, "dir");
        if (dir !== 90 && dir !== -90 && dir !== 180) {
          throw new PdfOpError(op, "dir", "90|-90|180");
        }
        for (const p of pages) push("rotations", { pageIndex: int(p, op, "pages[]"), delta: dir });
        break;
      }
      case "deletePage":
        push("deletedPages", int(a.pageIndex, op, "pageIndex"));
        break;
      case "setPageOrder": {
        const order = a.order;
        if (order !== null && !Array.isArray(order)) {
          throw new PdfOpError(op, "order", "array|null required");
        }
        req.pageOrder = order === null ? undefined : order.map((p) => int(p, op, "order[]"));
        break;
      }
      case "setMetadata":
        // Wire shape accepts either {metadata:{...}} or the flat fields.
        req.metadata = parseMetadata(isDict(a.metadata) ? a.metadata : a, op);
        break;
      // Upstream vocabulary that this lane deliberately does not bind:
      // annotation/form authoring (markups, drawings, notes, form values,
      // stamps, signatures) and OCR.
      case "ocrPage":
      case "ocr":
        throw new PdfOpError(op, "", "ocr is not a capability of this engine build (optical engines live outside the service)");
      default:
        throw new PdfOpError(op, "", "unknown op for pdf");
    }
  }
  return req;
}
