// Envelope edits[] → PdfEditRequest. Each item is {op, target, text,
// attributes}; the op names are upstream's canonical ones (op-docs.ts). A
// malformed item is a typed PdfOpError, never a silent drop — the caller's
// ops either all parse or the job fails before any byte is touched.
import type {
  AnnotDeleteInput,
  FormFieldInput,
  FormFieldKind,
  ImageEditInput,
  ImageLayer,
  MetadataInput,
  DrawingInput,
  DrawingGeometry,
  MarkupInput,
  NoteEditInput,
  NoteInput,
  NoteReplyTarget,
  NoteResolveInput,
  PdfEditRequest,
  StampInput,
  TextEditInput,
  TextInsertInput,
} from "./types.ts";
export { PdfOpError } from "./op-parse.ts";
import {
  attrsOf,
  bool,
  capEdits,
  capImageB64,
  capList,
  capText,
  type Dict,
  int,
  isDict,
  num,
  opt,
  parseExtractPages,
  parseInsertBlankPage,
  parseInsertPdfPages,
  parseMergePdfs,
  parseSetNUp,
  parseSetPageBox,
  parseSplitPdf,
  PdfOpError,
  rgb255,
  str,
  vec2,
  vec4,
} from "./op-parse.ts";
import { parseQuarterTurns } from "./stamps.ts";

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
    oldText: capText(str(a.oldText, op, "oldText"), op, "oldText"),
    newText: capText(str(a.newText, op, "newText"), op, "newText"),
    fontSize: num(a.fontSize, op, "fontSize"),
    newFontSize: opt(a.newFontSize, num, op, "newFontSize"),
    newColor: opt(a.newColor, rgb255, op, "newColor"),
    colorRuns: opt(a.colorRuns, (v, o, f) => {
      if (!Array.isArray(v)) throw new PdfOpError(o, f, "array required");
      return capList(v, o, f).map((r) => {
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
      return capList(v, o, f).map((r) => {
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
      return capList(v, o, f).map((n) => num(n, o, f));
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
    text: capText(str(a.text, op, "text"), op, "text"),
    fontSize: num(a.fontSize, op, "fontSize"),
    color: rgb255(a.color, op, "color"),
    font: opt(a.font, str, op, "font"),
    bold: opt(a.bold, bool, op, "bold"),
    italic: opt(a.italic, bool, op, "italic"),
    lineLeading: opt(a.lineLeading, num, op, "lineLeading"),
    lineXOffsets: opt(a.lineXOffsets, (v, o, f) => {
      if (!Array.isArray(v)) throw new PdfOpError(o, f, "array required");
      return capList(v, o, f).map((n) => num(n, o, f));
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
        image: capImageB64(str(a.image, op, "image"), op, "image"),
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
        image: capImageB64(str(a.image, op, "image"), op, "image"),
        layer: opt(a.layer, layer, op, "layer"),
        quarterTurns: opt(a.quarterTurns, int, op, "quarterTurns"),
      };
    case "deleteImage":
      return { ...base, kind, oldRect: vec4(a.oldRect, op, "oldRect") };
    default:
      throw new PdfOpError(op, "kind", "insertImage|transformImage|replaceImage|deleteImage");
  }
}

const STAMP_KINDS = new Set<StampInput["kind"]>(["image", "signature"]);
const STAMP_CONTENT_TYPES = new Set(["image/png", "image/jpeg"]);

function parseStamp(a: Dict, op: string): StampInput {
  const kind = str(a.kind, op, "kind") as StampInput["kind"];
  if (!STAMP_KINDS.has(kind)) throw new PdfOpError(op, "kind", "image|signature");
  const contentType = str(a.contentType, op, "contentType");
  if (!STAMP_CONTENT_TYPES.has(contentType)) throw new PdfOpError(op, "contentType", "image/png|image/jpeg");
  const signatureId = opt(a.signatureId, str, op, "signatureId");
  const rect = vec4(a.rect, op, "rect");
  if (rect[2] - rect[0] <= 0 || rect[3] - rect[1] <= 0) {
    throw new PdfOpError(op, "rect", "positive width and height required");
  }
  const image = capImageB64(str(a.image, op, "image"), op, "image");
  if (image === "") throw new PdfOpError(op, "image", "non-empty base64 image required");
  return {
    kind,
    pageIndex: int(a.pageIndex, op, "pageIndex"),
    rect,
    contentType,
    image,
    ...(signatureId === undefined ? {} : { signatureId }),
    quarterTurns: parseQuarterTurns(a.quarterTurns, op, "quarterTurns"),
  };
}

function parseMetadata(a: Dict, op: string): MetadataInput {
  return {
    title: opt(a.title, str, op, "title"),
    author: opt(a.author, str, op, "author"),
    subject: opt(a.subject, str, op, "subject"),
    keywords: opt(a.keywords, str, op, "keywords"),
  };
}

function rgbNormalized(v: unknown, op: string, f: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new PdfOpError(op, f, "[r,g,b] normalized tuple required");
  }
  return [v[0], v[1], v[2]] as [number, number, number];
}

function parseMarkup(a: Dict, op: string): MarkupInput {
  const type = str(a.type, op, "type");
  if (type !== "highlight" && type !== "underline" && type !== "strikeout") {
    throw new PdfOpError(op, "type", "highlight|underline|strikeout");
  }
  const quads = a.quads;
  if (!Array.isArray(quads) || quads.length === 0) throw new PdfOpError(op, "quads", "at least one quad required");
  const parsed = capList(quads, op, "quads").map((quad, index) => {
    if (!Array.isArray(quad) || quad.length !== 8 || !quad.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new PdfOpError(op, `quads[${index}]`, "eight finite coordinates required");
    }
    return quad as number[];
  });
  return {
    pageIndex: int(a.pageIndex, op, "pageIndex"),
    type,
    color: rgbNormalized(a.color, op, "color"),
    quads: parsed,
  };
}

function parseDrawing(a: Dict, op: string): DrawingInput {
  const kind = str(a.kind ?? a.type, op, "kind");
  if (kind !== "rect" && kind !== "ellipse" && kind !== "line" && kind !== "arrow" && kind !== "ink") throw new PdfOpError(op, "kind", "rect|ellipse|line|arrow|ink");
  let geometry: DrawingGeometry;
  if (isDict(a.geometry)) {
    if (isDict(a.geometry.rect)) {
      const r = a.geometry.rect;
      geometry = { rect: { x: num(r.x, op, "geometry.rect.x"), y: num(r.y, op, "geometry.rect.y"), width: num(r.width, op, "geometry.rect.width"), height: num(r.height, op, "geometry.rect.height") } };
    } else if (isDict(a.geometry.start) && isDict(a.geometry.end)) {
      geometry = { start: { x: num(a.geometry.start.x, op, "geometry.start.x"), y: num(a.geometry.start.y, op, "geometry.start.y") }, end: { x: num(a.geometry.end.x, op, "geometry.end.x"), y: num(a.geometry.end.y, op, "geometry.end.y") } };
    } else if (Array.isArray(a.geometry.points)) {
      geometry = { points: capList(a.geometry.points, op, "geometry.points").map((p, i) => { if (!isDict(p)) throw new PdfOpError(op, `geometry.points[${i}]`, "point object required"); return { x: num(p.x, op, `geometry.points[${i}].x`), y: num(p.y, op, `geometry.points[${i}].y`) }; }) };
    } else throw new PdfOpError(op, "geometry", "rect, start/end, or points required");
  } else if (a.rect !== undefined) {
    const r = vec4(a.rect, op, "rect");
    geometry = { rect: { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] } };
  } else if (a.start !== undefined && a.end !== undefined) {
    const s = vec2(a.start, op, "start"); const e = vec2(a.end, op, "end"); geometry = { start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] } };
  } else throw new PdfOpError(op, "geometry", "required");
  const color = rgbNormalized(a.color ?? a.strokeColor, op, "color");
  const width = num(a.width ?? a.strokeWidth, op, "width");
  if (width <= 0) throw new PdfOpError(op, "width", "positive number required");
  if (kind === "rect" || kind === "ellipse") if (!("rect" in geometry) || geometry.rect.width <= 0 || geometry.rect.height <= 0) throw new PdfOpError(op, "geometry.rect", "shape bounds must have positive dimensions");
  if ((kind === "line" || kind === "arrow") && !("start" in geometry)) throw new PdfOpError(op, "geometry", "line and arrow require start/end");
  if (kind === "ink" && !("points" in geometry)) throw new PdfOpError(op, "geometry.points", "ink requires points");
  if (kind !== "ink" && "points" in geometry) throw new PdfOpError(op, "geometry", "points only valid for ink");
  if (kind === "ink" && "points" in geometry && geometry.points.length < 2) throw new PdfOpError(op, "geometry.points", "at least two points required");
  return {
    pageIndex: int(a.pageIndex, op, "pageIndex"),
    kind,
    geometry,
    color,
    width,
    fill: opt(a.fill ?? a.fillColor, rgbNormalized, op, "fill"),
  };
}

/** The first candidate object carrying a field `name`, across the envelope
    shapes setFormValue arrives in (top-level `field`, AI `value`, merged
    `attributes`, or the item itself). */
function formValueDict(item: Dict, merged: Dict): Dict {
  for (const candidate of [item.field, item.value, merged.field, merged, item]) {
    if (isDict(candidate) && candidate.name !== undefined) return candidate;
  }
  return item;
}

const FORM_FIELD_KINDS = new Set<FormFieldKind>(["text", "checkbox", "radio", "choice"]);

function parseFormValue(a: Dict, op: string): FormFieldInput {
  const name = str(a.name, op, "name");
  if (name.trim() === "") throw new PdfOpError(op, "name", "non-empty field name required");
  const kind = str(a.kind, op, "kind") as FormFieldKind;
  if (!FORM_FIELD_KINDS.has(kind)) throw new PdfOpError(op, "kind", "text|checkbox|radio|choice");
  // A checkbox is a boolean (op-docs spells it `checked`; the host sends
  // `value`); a radio takes an option name or a boolean two-state write.
  if (kind === "checkbox") {
    return { name, kind, value: bool(a.value ?? a.checked, op, "value") };
  }
  if (kind === "radio" && typeof a.value === "boolean") {
    return { name, kind, value: a.value };
  }
  return { name, kind, value: capText(str(a.value, op, "value"), op, "value") };
}

/** Non-empty comment text — an empty note is a caller bug, not a valid annot. */
function noteContents(v: unknown, op: string, f: string): string {
  const value = capText(str(v, op, f), op, f);
  if (value.trim() === "") throw new PdfOpError(op, f, "non-empty text required");
  return value;
}

function parseNoteReplyTarget(v: unknown, op: string, f: string): NoteReplyTarget {
  if (!isDict(v)) throw new PdfOpError(op, f, "reply target object required");
  return {
    objNum: int(v.objNum, op, `${f}.objNum`),
    rect: vec4(v.rect, op, `${f}.rect`),
    contents: noteContents(v.contents, op, `${f}.contents`),
  };
}

function parseNote(a: Dict, op: string): NoteInput {
  if (a.replyTo !== undefined && a.replyToLocalId !== undefined) {
    throw new PdfOpError(op, "replyTo", "replyTo and replyToLocalId are mutually exclusive");
  }
  const rect = vec4(a.rect, op, "rect");
  if (rect[2] <= rect[0] || rect[3] <= rect[1]) throw new PdfOpError(op, "rect", "positive-width and positive-height rect required");
  return {
    pageIndex: int(a.pageIndex, op, "pageIndex"),
    rect,
    contents: noteContents(a.contents, op, "contents"),
    author: opt(a.author, str, op, "author"),
    createdMs: opt(a.createdMs, num, op, "createdMs"),
    localId: opt(a.localId, str, op, "localId"),
    replyTo: opt(a.replyTo, parseNoteReplyTarget, op, "replyTo"),
    replyToLocalId: opt(a.replyToLocalId, str, op, "replyToLocalId"),
  };
}

function parseNoteEdit(a: Dict, op: string): NoteEditInput {
  // Upstream shape: {annot:{pageIndex,objNum,rect,contents},contents}; flat
  // {…,oldContents,contents} is this lane's envelope.
  const identity = isDict(a.annot) ? a.annot : a;
  return {
    pageIndex: int(identity.pageIndex, op, "pageIndex"),
    objNum: int(identity.objNum, op, "objNum"),
    rect: vec4(identity.rect, op, "rect"),
    oldContents: noteContents(identity.oldContents ?? identity.contents, op, "oldContents"),
    contents: noteContents(a.contents, op, "contents"),
  };
}

function parseNoteResolve(a: Dict, op: string): NoteResolveInput {
  return {
    pageIndex: int(a.pageIndex, op, "pageIndex"),
    objNum: int(a.objNum, op, "objNum"),
    rect: vec4(a.rect, op, "rect"),
    contents: noteContents(a.contents, op, "contents"),
    resolved: bool(a.resolved, op, "resolved"),
  };
}

/** The B7 page-box / N-up payload dict. Unlike the other providers these
    envelopes arrive flat ({op, pages, box, rect}), so when `attrsOf` found no
    `target`/`attributes` fields the item's own top-level fields are used; a
    nested `pageBox`/`nUp` object is accepted too. */
function pageBoxPayload(item: Dict, merged: Dict): Dict {
  const nested = isDict(item.pageBox) ? item.pageBox : isDict(item.nUp) ? item.nUp : undefined;
  if (nested) return nested;
  return Object.keys(merged).length > 0 ? merged : item;
}

/**
 * Fold a validated envelope edits array into the engine's PdfEditRequest.
 * Unknown op names are a typed error (the caller learns the vocabulary is
 * narrower than upstream's, not that its op vanished).
 */
export function parsePdfOps(edits: unknown[]): PdfEditRequest {
  capEdits(edits);
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
      case "addMarkup":
        push("markups", parseMarkup(isDict(a.markup) ? a.markup : a, op));
        break;
      case "addDrawing":
        push("drawings", parseDrawing(isDict(a.drawing) ? a.drawing : a, op));
        break;
      case "addNote":
        push("notes", parseNote(isDict(a.note) ? a.note : a, op));
        break;
      case "editSavedNote":
        push("noteEdits", parseNoteEdit(a, op));
        break;
      case "resolveNote":
        push("noteResolves", parseNoteResolve(a, op));
        break;
      case "putTextEdit":
        push("textEdits", parseTextEdit(a, op));
        break;
      case "addTextInsert":
        push("textInserts", parseTextInsert(a, op));
        break;
      case "addImageEdit":
        push("imageEdits", parseImageEdit(a, op));
        break;
      case "addStamp":
        // The B6 provider nests the payload under `attributes.stamp`; the flat
        // shape ({op, ...fields}) is accepted too, like every other op.
        push("stamps", parseStamp(isDict(a.stamp) ? a.stamp : a, op));
        break;
      case "setFormValue":
        // The host sends the field at the top level ({op, field:{name,kind,
        // value}}); the AI tool schema nests it under `value`, and the generic
        // envelope carries it inside `attributes` (merged into `a`) or flat.
        push("formValues", parseFormValue(formValueDict(item, a), op));
        break;
      case "flattenForms":
        req.flattenForms = true;
        break;
      case "deleteSavedAnnot":
        // upstream shape: {annot:{pageIndex,objNum,type,rect,...}}
        push("annotDeletes", parseAnnotDelete(isDict(a.annot) ? a.annot : a, op));
        break;
      case "rotatePages": {
        const pages = a.pages;
        if (!Array.isArray(pages)) throw new PdfOpError(op, "pages", "array required");
        capList(pages, op, "pages");
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
        req.pageOrder = order === null ? undefined : capList(order, op, "order").map((p) => int(p, op, "order[]"));
        break;
      }
      case "setMetadata":
        // Wire shape accepts either {metadata:{...}} or the flat fields.
        req.metadata = parseMetadata(isDict(a.metadata) ? a.metadata : a, op);
        break;
      // Page-structure ops. `insertBlankPage` and `insertPdfPages` grow the
      // working document and may repeat, applied in request order;
      // `extractPages`, `mergePdfs` and `splitPdf` produce the NEW documents
      // the host commits and each occur at most once per request.
      case "insertBlankPage":
        push("blankPages", parseInsertBlankPage(a, op));
        break;
      case "insertPdfPages":
        push("insertedPdfs", parseInsertPdfPages(a, op));
        break;
      case "extractPages":
        if (req.extractPages) throw new PdfOpError(op, "", "at most one extractPages per request");
        req.extractPages = parseExtractPages(a, op);
        break;
      case "mergePdfs":
        if (req.mergePdfs) throw new PdfOpError(op, "", "at most one mergePdfs per request");
        req.mergePdfs = parseMergePdfs(a, op);
        break;
      case "splitPdf":
        if (req.splitPdf) throw new PdfOpError(op, "", "at most one splitPdf per request");
        req.splitPdf = parseSplitPdf(a, op);
        break;
      // B7 page-box / N-up. `setPageBox` may repeat (applied in request order);
      // `setNUp` replaces the page tree and occurs at most once per request.
      case "setPageBox":
        push("pageBoxes", parseSetPageBox(pageBoxPayload(item, a), op));
        break;
      case "setNUp":
        if (req.nUp) throw new PdfOpError(op, "", "at most one setNUp per request");
        req.nUp = parseSetNUp(pageBoxPayload(item, a), op);
        break;
      // Upstream vocabulary that this lane deliberately does not bind:
      // OCR (optical engines live outside this service).
      case "ocrPage":
      case "ocr":
        throw new PdfOpError(op, "", "ocr is not a capability of this engine build (optical engines live outside the service)", true);
      default:
        throw new PdfOpError(op, "", "unknown op for pdf", true);
    }
  }
  return req;
}
