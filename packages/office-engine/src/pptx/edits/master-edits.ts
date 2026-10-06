// B6e (UNI-927) - slide master / layout edits (logic half): the vendored
// PART-ADDRESSED element ops bound to one typed, validated op builder.
//
// Vendored contract (READ ONLY - never imported; cited for every field). A
// part-addressed op carries `target: { part, el }` instead of `target.slide`;
// only ops that pass `allowPart: true` accept it (registry.ts:243-262
// resolveSlide refuses a part for every other op; registry.ts:217-241
// resolvePart looks the path up in listMasterParts and parses it through
// parseMasterPart; registry.ts:282-305 resolveElement then matches `target.el`).
// Exactly five registered ops opt in:
//   setText        packages/pptx-ops/src/ops/text-ops.ts:138
//                  (validate :139-154 paragraphs array + resolveElement
//                   allowPart :153, text/shape only; apply :157 resolveSlide
//                   allowPart, :194 resolveElement allowPart; link rels and
//                   level rematerialisation are skipped on parts, :209-211)
//   setTransform   packages/pptx-ops/src/ops/element-ops.ts:80
//                  (validate :81-89 EMU rect `box` {x,y,cx,cy}, cx/cy >= 0
//                   (emuRect :52-70) + allowPart :88; apply :131 allowPart,
//                   `rotDeg` degrees, defaults 0 :91)
//   setFill        packages/pptx-ops/src/ops/core-ops.ts:49
//                  (validate :50-67 "none" | hex | gradient patch,
//                   resolveElement text/shape allowPart :67; apply :84)
//   setStroke      packages/pptx-ops/src/ops/core-ops.ts:95
//                  (validate :96-121 stroke patch | null, color hex,
//                   widthEmu finite > 0, optional gradient; element types
//                   text/shape/picture allowPart :121; apply :136)
//   deleteElement  packages/pptx-ops/src/ops/core-ops.ts:34
//                  (validate :36 allowPart; apply :39 allowPart)
// Every other element op (setFont, setParagraphFormat, setEffects, flip, ...)
// resolves through resolveSlide/resolveElement WITHOUT allowPart (for example
// setFont text-ops.ts:234-270, setEffects element-ops.ts:532) and so refuses a
// part target; this module therefore emits no op beyond the five above.
// hardenTargetIdentity (executor.ts:130-134) also resolves part targets.
//
// The desktop host drives the same five ops (apps/slides/src/main/slides-main.ts
// :2590 masterTxn, :2634 text, :2647 transform, :2690 fill, :2718 stroke, :2735
// delete) and enumerates parts with listMasterParts / MasterPartInfo
// (pptx-engine/src/master-edit.ts:20-58); `listMasterPartInfos` below is the
// browser-safe structural twin of listMasterParts (archive text only).
//
// The wire round registers `MasterEdit` as PptxEdit kinds in model.ts (gestures
// in wave-ab-gestures.ts call model.runBuiltTxn(buildMasterOps(...))).
//
// readMasterElements is the read half: it lists a part's elements (parse-time
// ids, px boxes, solid fill, text) through the vendored parseMasterPart that
// the engine seam binds (engine.ts PptxEngineFunctions.parseMasterPart).
//
// Element existence cannot be checked here: element ids are parse-time ids of
// the part's parsed spTree (parseMasterPart), and parsing needs the vendored
// engine. The executor's own guided error ("no element X on part P. Available:
// [...]", registry.ts:298-303) is the authority and surfaces unchanged; this
// builder refuses only empty/non-string ids (`no_master_element`).
import {
  PptxEngineError,
  type OpenedPptxLike,
  type PptxElementLike,
  type PptxMasterPartLike,
  type PptxOp,
  type PptxParagraphLike,
} from "../engine";
import { EMU_PER_PX_96, makePxToEmu } from "../model";
import {
  PPTX_GRADIENT_PATHS,
  PPTX_STROKE_CAPS,
  PPTX_STROKE_COMPOUNDS,
  PPTX_STROKE_JOINS,
  type PptxFillPatch,
  type PptxStrokePatch,
} from "./format-edits";

/** One master or layout part (structural twin of pptx-engine MasterPartInfo,
 * master-edit.ts:20-27). Masters come first, each followed by its layouts. */
export interface MasterPartInfo {
  /** Path inside the package, e.g. ppt/slideMasters/slideMaster1.xml. */
  partPath: string;
  kind: "master" | "layout";
  /** <p:cSld name="...">, falling back to the file name. */
  name: string;
}

/** The edit kinds this module builds (registered as PptxEdit kinds by the wire
 * round). Every member addresses a master/layout part by `part` and an element
 * on it by `elementId` (parse-time id or durable id, registry.ts:68-70).
 *  - master_edit_text      -> vendored `setText` (text/shape elements);
 *  - master_set_transform  -> vendored `setTransform`; pixel geometry at the
 *                             renderer's fit width converts to EMU like slides;
 *  - master_set_fill       -> vendored `setFill` (text/shape elements);
 *  - master_set_stroke     -> vendored `setStroke` (null removes the outline);
 *  - master_delete_element -> vendored `deleteElement`. */
export type MasterEdit =
  | { op: "master_edit_text"; part: string; elementId: string; paragraphs: PptxParagraphLike[] }
  | {
      op: "master_set_transform";
      part: string;
      elementId: string;
      xPx: number;
      yPx: number;
      wPx: number;
      hPx: number;
      /** degrees; defaults to 0 (element-ops.ts:97). */
      rotationDeg?: number;
    }
  | { op: "master_set_fill"; part: string; elementId: string; fill: PptxFillPatch }
  | { op: "master_set_stroke"; part: string; elementId: string; stroke: PptxStrokePatch | null }
  | { op: "master_delete_element"; part: string; elementId: string };

const MASTER_PART_RE = /^ppt\/slideMasters\/slideMaster\d+\.xml$/;
const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

const partNumber = (path: string): number => Number.parseInt(/(\d+)\.xml$/.exec(path)?.[1] ?? "0", 10);

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1, -4);

/** Same resolution as zip.ts:254-264 resolveTarget. */
const resolveTarget = (basePart: string, target: string): string => {
  if (target.startsWith("/")) return target.slice(1);
  const segments = basePart.slice(0, basePart.lastIndexOf("/")).split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") segments.pop();
    else segments.push(seg);
  }
  return segments.join("/");
};

const relsPathFor = (part: string): string => {
  const cut = part.lastIndexOf("/");
  return part.slice(0, cut) + "/_rels/" + part.slice(cut + 1) + ".rels";
};

const attr = (tag: string, name: string): string | undefined =>
  new RegExp("\\b" + name + '="([^"]*)"').exec(tag)?.[1];

/** Layout part paths a master relates to (rels of type .../slideLayout). */
const layoutTargets = (readText: (path: string) => string | null | undefined, master: string): string[] => {
  const xml = readText(relsPathFor(master));
  if (!xml) return [];
  const out: string[] = [];
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const type = attr(match[0], "Type");
    const target = attr(match[0], "Target");
    if (type?.endsWith("/slideLayout") && target) out.push(resolveTarget(master, target));
  }
  return out.sort((a, b) => partNumber(a) - partNumber(b));
};

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The five predefined XML entities, decoded in one pass (`&amp;amp;` -> `&amp;`). */
const decodeXmlEntities = (value: string): string =>
  value.replace(/&(amp|lt|gt|quot|apos);/g, (all, name: string) => XML_ENTITIES[name] ?? all);

/** cSldName (master-edit.ts:33-36): `<p:cSld name="...">`, else the file name.
 *  The attribute is XML text and the write side (renamePartXml) escapes it, so
 *  this decodes it; otherwise a rename shows and re-saves the escaped form. */
const cSldName = (xml: string | null | undefined, fallback: string): string => {
  const match = xml ? /<p:cSld\s[^>]*name="([^"]*)"/.exec(xml) : null;
  return match?.[1] ? decodeXmlEntities(match[1]) : fallback;
};

const entryNames = (archive: NonNullable<OpenedPptxLike["archive"]>): string[] => {
  const entries = archive.entries;
  if (entries instanceof Map) return [...entries.keys()].map(String);
  return entries && typeof entries === "object" ? Object.keys(entries) : [];
};

/** Enumerate the deck's master parts, each master followed by its layouts, for
 * the master-edit view. Pure over the held archive (entry names + part text);
 * a deck without an archive answers an empty list. */
export function listMasterPartInfos(opened: OpenedPptxLike): MasterPartInfo[] {
  const archive = opened.archive;
  if (!archive) return [];
  const readText = (path: string): string | null | undefined => archive.readText?.(path);
  const masters = entryNames(archive)
    .filter((path) => MASTER_PART_RE.test(path))
    .sort((a, b) => partNumber(a) - partNumber(b));
  const out: MasterPartInfo[] = [];
  for (const master of masters) {
    out.push({ partPath: master, kind: "master", name: cSldName(readText(master), baseName(master)) });
    for (const layout of layoutTargets(readText, master)) {
      out.push({ partPath: layout, kind: "layout", name: cSldName(readText(layout), baseName(layout)) });
    }
  }
  return out;
};

const badEdit = (code: string, op: string, detail: string): PptxEngineError =>
  new PptxEngineError(code, op + ": " + detail);

/** Mirrors registry.ts:217-228 resolvePart's refusal, with a stable code. */
const requirePart = (opened: OpenedPptxLike, part: unknown, op: string): string => {
  if (typeof part !== "string" || part.length === 0) {
    throw badEdit("bad_master_part", op, '"part" must be a master/layout part path');
  }
  const known = listMasterPartInfos(opened).map((info) => info.partPath);
  if (!known.includes(part)) {
    throw badEdit("bad_master_part", op, 'no master/layout part "' + part + '". Available: [' + known.join(", ") + "]");
  }
  return part;
};

const requireElementId = (elementId: unknown, op: string): string => {
  if (typeof elementId !== "string" || elementId.length === 0) {
    throw badEdit("no_master_element", op, "elementId must be a non-empty string");
  }
  return elementId;
};

const requireNumber = (value: unknown, op: string, field: string, code: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badEdit(code, op, '"' + field + '" must be a finite number');
  }
  return value;
};

const requireHex = (value: unknown, op: string, field: string, code: string): string => {
  if (typeof value !== "string" || !HEX_COLOR_RE.test(value)) {
    throw badEdit(code, op, '"' + field + '" must be a hex color "#RRGGBB" (or "#RRGGBBAA")');
  }
  return value;
};

const requireGeometry = (value: unknown, op: string, field: string): number => {
  const n = requireNumber(value, op, field, "bad_master_geometry");
  if (n < 0) throw badEdit("bad_master_geometry", op, '"' + field + '" must be >= 0');
  return n;
};

/** setText needs a paragraph array (text-ops.ts:140); the model-level guard
 * (model.ts checkParagraphs) additionally wants string runs, mirrored here. */
const requireParagraphs = (paragraphs: unknown, op: string): PptxParagraphLike[] => {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    throw badEdit("bad_master_text", op, '"paragraphs" must be a non-empty array');
  }
  for (const paragraph of paragraphs as PptxParagraphLike[]) {
    const runs = paragraph?.runs;
    if (!Array.isArray(runs) || runs.length === 0 || runs.some((run) => typeof run?.text !== "string")) {
      throw badEdit("bad_master_text", op, "every paragraph needs at least one run with string text");
    }
  }
  return paragraphs as PptxParagraphLike[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** requireGradientStops (registry.ts:138-149): >= 2 stops, pos 0..1, hex color. */
const requireStops = (stops: unknown, op: string, field: string, code: string): Array<{ pos: number; color: string }> => {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw badEdit(code, op, '"' + field + '" needs at least two { pos, color } entries');
  }
  return stops.map((raw, index) => {
    const stop = (isRecord(raw) ? raw : {}) as { pos?: unknown; color?: unknown };
    const where = field + "[" + index + "]";
    const pos = requireNumber(stop.pos, op, where + ".pos", code);
    if (pos < 0 || pos > 1) throw badEdit(code, op, '"' + where + '.pos" must be a fraction 0..1');
    return { pos, color: requireHex(stop.color, op, where + ".color", code) };
  });
};

const normalizeFill = (value: unknown, op: string): PptxFillPatch => {
  if (typeof value === "string") {
    return value === "none" ? "none" : requireHex(value, op, "fill", "bad_master_fill");
  }
  if (!isRecord(value)) {
    throw badEdit("bad_master_fill", op, '"fill" must be "none", a "#RRGGBB" color, or a gradient patch object');
  }
  const fill: Exclude<PptxFillPatch, string> = { stops: requireStops(value.stops, op, "fill.stops", "bad_master_fill") };
  if (value.angle !== undefined) fill.angle = requireNumber(value.angle, op, "fill.angle", "bad_master_fill");
  if (value.radial !== undefined) {
    if (typeof value.radial !== "boolean") throw badEdit("bad_master_fill", op, '"fill.radial" must be a boolean');
    fill.radial = value.radial;
  }
  if (value.path !== undefined) {
    if (!(PPTX_GRADIENT_PATHS as readonly unknown[]).includes(value.path)) {
      throw badEdit("bad_master_fill", op, '"fill.path" must be one of ' + PPTX_GRADIENT_PATHS.join(", "));
    }
    fill.path = value.path as (typeof PPTX_GRADIENT_PATHS)[number];
  }
  if (value.fillTo !== undefined) {
    const focus = value.fillTo;
    if (!isRecord(focus)) throw badEdit("bad_master_fill", op, '"fill.fillTo" must be { l, t, r, b } fractions');
    fill.fillTo = {
      l: requireNumber(focus.l, op, "fill.fillTo.l", "bad_master_fill"),
      t: requireNumber(focus.t, op, "fill.fillTo.t", "bad_master_fill"),
      r: requireNumber(focus.r, op, "fill.fillTo.r", "bad_master_fill"),
      b: requireNumber(focus.b, op, "fill.fillTo.b", "bad_master_fill"),
    };
  }
  return fill;
};

const requireOneOf = <T extends readonly string[]>(value: unknown, allowed: T, op: string, field: string): T[number] => {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw badEdit("bad_master_stroke", op, '"' + field + '" must be one of ' + allowed.join(", "));
  }
  return value as T[number];
};

const normalizeStroke = (value: unknown, op: string): PptxStrokePatch | null => {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw badEdit("bad_master_stroke", op, '"stroke" must be a stroke patch object, or null to remove the outline');
  }
  const color = requireHex(value.color, op, "stroke.color", "bad_master_stroke");
  const widthEmu = requireNumber(value.widthEmu, op, "stroke.widthEmu", "bad_master_stroke");
  if (widthEmu <= 0) throw badEdit("bad_master_stroke", op, '"stroke.widthEmu" must be > 0 (12700 EMU = 1pt)');
  const stroke: PptxStrokePatch = { color, widthEmu };
  if (value.dash !== undefined) {
    if (typeof value.dash !== "string" || value.dash.length === 0) {
      throw badEdit("bad_master_stroke", op, '"stroke.dash" must be a non-empty prstDash name');
    }
    stroke.dash = value.dash;
  }
  if (value.cap !== undefined) stroke.cap = requireOneOf(value.cap, PPTX_STROKE_CAPS, op, "stroke.cap");
  if (value.compound !== undefined) {
    stroke.compound = requireOneOf(value.compound, PPTX_STROKE_COMPOUNDS, op, "stroke.compound");
  }
  if (value.join !== undefined) stroke.join = requireOneOf(value.join, PPTX_STROKE_JOINS, op, "stroke.join");
  if (value.gradient !== undefined) {
    const gradient = value.gradient;
    if (!isRecord(gradient)) throw badEdit("bad_master_stroke", op, '"stroke.gradient" must be { stops, angle }');
    stroke.gradient = {
      stops: requireStops(gradient.stops, op, "stroke.gradient.stops", "bad_master_stroke"),
      angle: requireNumber(gradient.angle, op, "stroke.gradient.angle", "bad_master_stroke"),
    };
  }
  return stroke;
};

/** One validated master/layout edit -> the vendored part-addressed op the
 * executor runs. Refusals are typed PptxEngineError codes: bad_master_part
 * (missing/unknown part), no_master_element (empty element id),
 * bad_master_text, bad_master_geometry, bad_master_fill, bad_master_stroke,
 * bad_master_edit (unknown edit kind). Geometry is pixels at `fitWidthPx`
 * (same scale as slides, makePxToEmu); fill/stroke widths are EMU as the
 * vendored patches define them. */
export function buildMasterOps(opened: OpenedPptxLike, fitWidthPx: number, edit: MasterEdit): PptxOp[] {
  const kind = (edit as { op?: unknown }).op;
  switch (edit.op) {
    case "master_edit_text": {
      const target = { part: requirePart(opened, edit.part, edit.op), el: requireElementId(edit.elementId, edit.op) };
      return [{ op: "setText", target, paragraphs: requireParagraphs(edit.paragraphs, edit.op) }];
    }
    case "master_set_transform": {
      const target = { part: requirePart(opened, edit.part, edit.op), el: requireElementId(edit.elementId, edit.op) };
      const x = requireGeometry(edit.xPx, edit.op, "xPx");
      const y = requireGeometry(edit.yPx, edit.op, "yPx");
      const w = requireGeometry(edit.wPx, edit.op, "wPx");
      const h = requireGeometry(edit.hPx, edit.op, "hPx");
      const rotDeg = edit.rotationDeg === undefined ? 0 : requireNumber(edit.rotationDeg, edit.op, "rotationDeg", "bad_master_geometry");
      const toEmu = makePxToEmu(opened, fitWidthPx);
      return [
        {
          op: "setTransform",
          target,
          box: { x: toEmu(x), y: toEmu(y), cx: Math.max(1, toEmu(w)), cy: Math.max(1, toEmu(h)) },
          rotDeg,
        },
      ];
    }
    case "master_set_fill": {
      const target = { part: requirePart(opened, edit.part, edit.op), el: requireElementId(edit.elementId, edit.op) };
      return [{ op: "setFill", target, fill: normalizeFill(edit.fill, edit.op) }];
    }
    case "master_set_stroke": {
      const target = { part: requirePart(opened, edit.part, edit.op), el: requireElementId(edit.elementId, edit.op) };
      return [{ op: "setStroke", target, stroke: normalizeStroke(edit.stroke, edit.op) }];
    }
    case "master_delete_element": {
      const target = { part: requirePart(opened, edit.part, edit.op), el: requireElementId(edit.elementId, edit.op) };
      return [{ op: "deleteElement", target }];
    }
    default:
      throw new PptxEngineError("bad_master_edit", "unknown master edit kind " + String(kind));
  }
}

/** One element of a master/layout part as the Masters panel shows it. */
export interface MasterElementData {
  /** Parse-time id: the `elementId` every master_* edit targets. */
  id: string;
  type: string;
  /** Placeholder kind (or element type) plus a short text excerpt. */
  label: string;
  /** Px at the model's fit width: the inverse of makePxToEmu. */
  box: { x: number; y: number; w: number; h: number };
  placeholder?: string;
  /** `<p:ph idx>` of a placeholder that has one: names which of two same-type slots this is. */
  idx?: number;
  /** "#RRGGBB" when the element has a solid fill, else null. */
  fill?: string | null;
  /** Plain text of a text/shape element (paragraphs joined by newline). */
  text?: string;
}

/** The vendored parseMasterPart as the engine seam binds it. */
type ParseMasterPart = (archive: unknown, partPath: string) => PptxMasterPartLike | null;

const LABEL_TEXT_MAX = 40;
const SOLID_HEX_RE = /^#?([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?$/;

const round2 = (n: number): number => Math.round(n * 100) / 100;

const paragraphsText = (element: PptxElementLike): string | undefined => {
  if (!element.text) return undefined;
  return (element.text.paragraphs ?? []).map((p) => (p.runs ?? []).map((r) => r.text ?? "").join("")).join("\n");
};

/** Solid fill -> "#RRGGBB" (alpha dropped); every other fill kind -> null. */
const solidFillHex = (element: PptxElementLike): string | null => {
  const fill = element.fill as { type?: unknown; color?: unknown } | undefined;
  if (!fill || fill.type !== "solid" || typeof fill.color !== "string") return null;
  const match = SOLID_HEX_RE.exec(fill.color);
  return match ? "#" + (match[1] as string).toUpperCase() : null;
};

const elementLabel = (element: PptxElementLike, text: string | undefined): string => {
  const base = typeof element.placeholder === "string" && element.placeholder ? element.placeholder : element.type;
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return base;
  return base + ": " + (flat.length > LABEL_TEXT_MAX ? flat.slice(0, LABEL_TEXT_MAX - 1) + "…" : flat);
};

/** The cNvPr form ("e_<id>") of an element id. The vendored parser re-mints the
 * parse-time id on every parse (each op transaction parses the part again), so
 * that id never resolves in a later edit; the executor's matchesElementRef
 * (identity.ts:68) also accepts this form, which is stable across parses and
 * stays an alias after an edit mints a creationId. Falls back to the parse id. */
const durableMasterId = (element: PptxElementLike): string => {
  const xml = (element as { anchor?: { originalXml?: unknown } }).anchor?.originalXml;
  const open = typeof xml === "string" ? /<p:cNvPr\b[^>]*?\/?>/.exec(xml)?.[0] : undefined;
  const cNvPr = open ? /\bid="(\d+)"/.exec(open)?.[1] : undefined;
  if (cNvPr) return "e_" + cNvPr;
  const nvId = (element as { nvId?: unknown }).nvId;
  return typeof nvId === "number" || typeof nvId === "string" ? "e_" + String(nvId) : element.id;
};

/** `<p:ph idx>` from the element's shape XML; absent on a title or a non-placeholder. */
const placeholderIdx = (element: PptxElementLike): number | undefined => {
  const xml = (element as { anchor?: { originalXml?: unknown } }).anchor?.originalXml;
  const idx = typeof xml === "string" ? /<p:ph\b[^>]*?\sidx\s*=\s*["'](\d+)["']/.exec(xml)?.[1] : undefined;
  return idx === undefined ? undefined : Number(idx);
};

/** The elements of one master/layout part for the Masters panel. Pure: the
 * part is parsed by `parse` (the bound vendored parseMasterPart) from the
 * held archive. Refusals: bad_master_part (unknown part, or one that parses to
 * nothing), master_unbound (no parser bound), plus bad_fit_width /
 * deck_size_missing from makePxToEmu. */
export function readMasterElements(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  partPath: string,
  parse?: ParseMasterPart,
): MasterElementData[] {
  const part = requirePart(opened, partPath, "readMasterElements");
  if (!parse) {
    throw new PptxEngineError("master_unbound", "readMasterElements: no master part parser is bound for this engine");
  }
  makePxToEmu(opened, fitWidthPx); // validates deck size + fit width
  const parsed = parse(opened.archive, part);
  if (!parsed || !Array.isArray(parsed.elements)) {
    throw badEdit("bad_master_part", "readMasterElements", 'part "' + part + '" could not be parsed');
  }
  const pxPerEmu = fitWidthPx / (opened.deck.size!.cx / EMU_PER_PX_96) / EMU_PER_PX_96;
  return parsed.elements.map((element) => {
    const offset = element.transform?.offset;
    const text = paragraphsText(element);
    const data: MasterElementData = {
      id: durableMasterId(element),
      type: element.type,
      label: elementLabel(element, text),
      box: {
        x: round2((offset?.x ?? 0) * pxPerEmu),
        y: round2((offset?.y ?? 0) * pxPerEmu),
        w: round2((offset?.cx ?? 0) * pxPerEmu),
        h: round2((offset?.cy ?? 0) * pxPerEmu),
      },
      fill: solidFillHex(element),
    };
    if (typeof element.placeholder === "string" && element.placeholder) data.placeholder = element.placeholder;
    const idx = placeholderIdx(element);
    if (idx !== undefined) data.idx = idx;
    if (text !== undefined) data.text = text;
    return data;
  });
}
