// XLSX visuals (B8, UNI-940 X02): charts, pictures and shapes inserted in the
// editor. The typed ops, the wire parser and the fold into the gateway's
// `visualAdditions` argument (SheetVisualAddition, bound by office-upstream
// patch 0010) live here.
//
// Wire shape:
//   { op: "set_visual", target: { sheet }, attributes: { id, anchor, chart | shape | image } }
//   { op: "set_visual", target: { sheet }, attributes: { id, anchor } }   (move)
//   { op: "remove_visual", target: { sheet }, attributes: { id } }
//   { op: "set_visual", target: { sheet }, attributes: { file, anchor } }  (move a file visual)
//   { op: "remove_visual", target: { sheet }, attributes: { file } }       (delete a file visual)
// `id` is the editor's handle for one session visual. The insert carries the
// body once; a move or resize is the anchor-only form, which keeps the pending
// visual's body and only replaces its anchor, so nudging a large picture never
// re-sends its bytes. An anchor-only set_visual with no pending visual of that
// id is refused (a media-less insert). A set_visual with a body and a pending
// id replaces it in place; remove_visual cancels it.
// `file` (UNI-953) addresses a visual ALREADY IN THE FILE: the anchor's index
// in the sheet's drawing part, in document order (the gateway's visualEdits
// drawingIndex, bound by patch 0013; render-model-visuals.ts reads the same
// order). A visual an earlier save wrote is addressed this way too. The last
// move per (sheet, file) wins; a move after a remove restores the visual
// (undo of a delete), while a second remove is refused.
//
// The anchor is a two-cell anchor in final (post-structural) coordinates:
// 0-based row/column plus EMU offsets inside the cell, exactly the gateway's
// DrawingAnchor. Each visual is a NEW drawing part entry on save
// (xl/drawings/drawingN.xml, plus xl/charts/chartN.xml or xl/media/imageN.*).
import { XlsxOpError, isDict, int, str, parseStructuralTarget, parseStructuralAttributes, MAX_ROWS, MAX_COLS, type Dict, type XlsxEditOp, type XlsxSheetResolver } from "./ops-shared.ts";

const VISUAL_SET_OP_KIND = "set_visual";
const VISUAL_REMOVE_OP_KIND = "remove_visual";
/** The parsed anchor-only form of set_visual (no wire name of its own). */
const VISUAL_MOVE_OP_KIND = "move_visual";
/** The parsed `file` forms (a visual already in the file). */
const FILE_MOVE_OP_KIND = "move_file_visual";
const FILE_REMOVE_OP_KIND = "remove_file_visual";
/** The gateway's drawingIndex bound (edit-schemas.ts). */
const MAX_FILE_INDEX = 10_000;

/** Chart kinds the editor inserts; all are written by the vendored buildChartXml. */
const XLSX_VISUAL_CHART_TYPES = ["column", "bar", "line", "pie", "area", "doughnut"] as const;
export type XlsxVisualChartType = (typeof XLSX_VISUAL_CHART_TYPES)[number];

/** DrawingML preset geometries the shape picker offers (`a:prstGeom prst`). */
const XLSX_VISUAL_SHAPE_TYPES = ["rect", "roundRect", "ellipse", "triangle", "rightArrow", "leftArrow", "line"] as const;
export type XlsxVisualShapeType = (typeof XLSX_VISUAL_SHAPE_TYPES)[number];

export const XLSX_VISUAL_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif"] as const;
export type XlsxVisualImageType = (typeof XLSX_VISUAL_IMAGE_TYPES)[number];

/** Decoded picture ceiling. The server bounds one save's edits at 8 MiB; the
 *  picture rides only its insert op (moves are anchor-only), so the base64
 *  text (4/3 of this) leaves room for many pictures and the rest of the save. */
export const XLSX_VISUAL_MAX_IMAGE_BYTES = 512 * 1024;
const MAX_SERIES = 24;
const MAX_POINTS = 1_000;
const MAX_TEXT = 255;
const MAX_CATEGORY = 1_024;
const MAX_REF = 512;
/** One cell edge in EMU is far below this; it only rejects absurd offsets. */
const MAX_OFFSET_EMU = 100_000_000;
const VISUAL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The gateway's DrawingAnchor (xlsx-drawing-add.ts). */
export interface XlsxVisualAnchor {
  readonly fromRow: number;
  readonly fromColumn: number;
  readonly fromRowOffset: number;
  readonly fromColumnOffset: number;
  readonly toRow: number;
  readonly toColumn: number;
  readonly toRowOffset: number;
  readonly toColumnOffset: number;
}

export interface XlsxVisualChartSeries {
  readonly name: string;
  readonly categories: readonly string[];
  readonly values: readonly number[];
  readonly valuesRef?: string | undefined;
  readonly categoriesRef?: string | undefined;
}

/** The gateway's ChartAdd subset the editor writes. */
export interface XlsxVisualChart {
  readonly chartType: XlsxVisualChartType;
  readonly title: string;
  readonly series: readonly XlsxVisualChartSeries[];
}

/** The gateway's ShapeAdd. */
export interface XlsxVisualShape {
  readonly shapeType: XlsxVisualShapeType;
  readonly fillColor?: string | undefined;
  readonly text?: string | undefined;
}

/** The gateway's ImageAdd. */
export interface XlsxVisualImage {
  readonly mediaType: XlsxVisualImageType;
  readonly base64: string;
}

export interface XlsxVisualSetOp {
  readonly kind: "set_visual";
  readonly sheetName: string;
  readonly id: string;
  readonly anchor: XlsxVisualAnchor;
  readonly chart?: XlsxVisualChart | undefined;
  readonly shape?: XlsxVisualShape | undefined;
  readonly image?: XlsxVisualImage | undefined;
}

/** A move or resize: the anchor-only set_visual. */
export interface XlsxVisualMoveOp {
  readonly kind: "move_visual";
  readonly sheetName: string;
  readonly id: string;
  readonly anchor: XlsxVisualAnchor;
}

export interface XlsxVisualRemoveOp {
  readonly kind: "remove_visual";
  readonly sheetName: string;
  readonly id: string;
}

/** The gateway's SheetVisualAddition: the `visualAdditions` argument shape. */
export interface XlsxSheetVisualAddition {
  readonly sheetName: string;
  readonly anchor: XlsxVisualAnchor;
  readonly chart?: XlsxVisualChart | undefined;
  readonly shape?: XlsxVisualShape | undefined;
  readonly image?: XlsxVisualImage | undefined;
}

/** A move of a visual already in the file (`file` = drawing index). */
export interface XlsxFileVisualMoveOp {
  readonly kind: "move_file_visual";
  readonly sheetName: string;
  readonly file: number;
  readonly anchor: XlsxVisualAnchor;
}

/** A delete of a visual already in the file. */
export interface XlsxFileVisualRemoveOp {
  readonly kind: "remove_file_visual";
  readonly sheetName: string;
  readonly file: number;
}

/** The pending edit of one file visual: its last anchor, or its removal. */
interface XlsxFileVisualEntry {
  readonly kind: "file_visual";
  readonly sheetName: string;
  readonly file: number;
  readonly anchor?: XlsxVisualAnchor | undefined;
  readonly remove?: true | undefined;
}

/** One entry of the model's visual journal: a session visual or a file edit. */
export type XlsxVisualEntry = XlsxVisualSetOp | XlsxFileVisualEntry;

/** The gateway's WorkbookVisualEdit (patch 0013 visualEdits). */
export interface XlsxWorkbookVisualEdit {
  readonly drawingPath: string;
  readonly drawingIndex: number;
  readonly remove?: true | undefined;
  readonly anchor?: XlsxVisualAnchor | undefined;
}

type XlsxVisualOp = XlsxVisualSetOp | XlsxVisualMoveOp | XlsxVisualRemoveOp | XlsxFileVisualMoveOp | XlsxFileVisualRemoveOp;

export function isXlsxVisualOp(op: XlsxEditOp): op is XlsxVisualOp {
  return (
    op.kind === VISUAL_SET_OP_KIND || op.kind === VISUAL_MOVE_OP_KIND || op.kind === VISUAL_REMOVE_OP_KIND || op.kind === FILE_MOVE_OP_KIND || op.kind === FILE_REMOVE_OP_KIND
  );
}

function onlyKeys(raw: Dict, allowed: readonly string[], op: string, field: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new XlsxOpError(op, field + "." + key, "unknown field");
  }
}

function boundedText(raw: unknown, max: number, op: string, field: string): string {
  const text = str(raw, op, field);
  if (text.length > max) throw new XlsxOpError(op, field, `at most ${max} characters`);
  return text;
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], op: string, field: string): T {
  const value = str(raw, op, field);
  if (!(allowed as readonly string[]).includes(value)) throw new XlsxOpError(op, field, `one of ${allowed.join(", ")} required`);
  return value as T;
}

function parseId(raw: unknown, op: string): string {
  const id = str(raw, op, "attributes.id");
  if (!VISUAL_ID.test(id)) throw new XlsxOpError(op, "attributes.id", "1-64 letters, digits, _ or - required");
  return id;
}

function parseFileIndex(raw: unknown, op: string): number {
  const index = int(raw, op, "attributes.file");
  if (index < 0 || index > MAX_FILE_INDEX) throw new XlsxOpError(op, "attributes.file", `0-${MAX_FILE_INDEX} required`);
  return index;
}

function parseAnchor(raw: unknown, op: string): XlsxVisualAnchor {
  if (!isDict(raw)) throw new XlsxOpError(op, "attributes.anchor", "object required");
  const keys = ["fromRow", "fromColumn", "fromRowOffset", "fromColumnOffset", "toRow", "toColumn", "toRowOffset", "toColumnOffset"] as const;
  onlyKeys(raw, keys, op, "attributes.anchor");
  const v = Object.fromEntries(keys.map((key) => [key, int(raw[key], op, "attributes.anchor." + key)])) as Record<(typeof keys)[number], number>;
  if (v.fromRow < 0 || v.toRow >= MAX_ROWS || v.fromColumn < 0 || v.toColumn >= MAX_COLS) {
    throw new XlsxOpError(op, "attributes.anchor", "anchor cells must lie inside the OOXML grid");
  }
  for (const key of ["fromRowOffset", "fromColumnOffset", "toRowOffset", "toColumnOffset"] as const) {
    if (v[key] < 0 || v[key] > MAX_OFFSET_EMU) throw new XlsxOpError(op, "attributes.anchor." + key, "offset out of range");
  }
  const after = (endCell: number, endOffset: number, startCell: number, startOffset: number) =>
    endCell > startCell || (endCell === startCell && endOffset > startOffset);
  if (!after(v.toRow, v.toRowOffset, v.fromRow, v.fromRowOffset) || !after(v.toColumn, v.toColumnOffset, v.fromColumn, v.fromColumnOffset)) {
    throw new XlsxOpError(op, "attributes.anchor", "the anchor must end below and right of where it starts");
  }
  return v;
}

function parseSeries(raw: unknown, op: string, index: number): XlsxVisualChartSeries {
  const field = `attributes.chart.series[${index}]`;
  if (!isDict(raw)) throw new XlsxOpError(op, field, "object required");
  onlyKeys(raw, ["name", "categories", "values", "valuesRef", "categoriesRef"], op, field);
  if (!Array.isArray(raw.values) || raw.values.length === 0 || raw.values.length > MAX_POINTS) {
    throw new XlsxOpError(op, field + ".values", `1-${MAX_POINTS} values required`);
  }
  const values = raw.values.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new XlsxOpError(op, field + ".values", "finite numbers required");
    return value;
  });
  if (!Array.isArray(raw.categories) || raw.categories.length > MAX_POINTS) {
    throw new XlsxOpError(op, field + ".categories", `at most ${MAX_POINTS} categories`);
  }
  const categories = raw.categories.map((category) => boundedText(category, MAX_CATEGORY, op, field + ".categories"));
  return {
    name: boundedText(raw.name, MAX_TEXT, op, field + ".name"),
    categories,
    values,
    ...(raw.valuesRef === undefined ? {} : { valuesRef: boundedText(raw.valuesRef, MAX_REF, op, field + ".valuesRef") }),
    ...(raw.categoriesRef === undefined ? {} : { categoriesRef: boundedText(raw.categoriesRef, MAX_REF, op, field + ".categoriesRef") }),
  };
}

function parseChart(raw: Dict, op: string): XlsxVisualChart {
  onlyKeys(raw, ["chartType", "title", "series"], op, "attributes.chart");
  if (!Array.isArray(raw.series) || raw.series.length === 0 || raw.series.length > MAX_SERIES) {
    throw new XlsxOpError(op, "attributes.chart.series", `1-${MAX_SERIES} series required`);
  }
  return {
    chartType: oneOf(raw.chartType, XLSX_VISUAL_CHART_TYPES, op, "attributes.chart.chartType"),
    title: raw.title === undefined ? "" : boundedText(raw.title, MAX_TEXT, op, "attributes.chart.title"),
    series: raw.series.map((series, index) => parseSeries(series, op, index)),
  };
}

function parseShape(raw: Dict, op: string): XlsxVisualShape {
  onlyKeys(raw, ["shapeType", "fillColor", "text"], op, "attributes.shape");
  let fillColor: string | undefined;
  if (raw.fillColor !== undefined) {
    fillColor = str(raw.fillColor, op, "attributes.shape.fillColor");
    if (!HEX_COLOR.test(fillColor)) throw new XlsxOpError(op, "attributes.shape.fillColor", "#RRGGBB required");
  }
  return {
    shapeType: oneOf(raw.shapeType, XLSX_VISUAL_SHAPE_TYPES, op, "attributes.shape.shapeType"),
    ...(fillColor === undefined ? {} : { fillColor }),
    ...(raw.text === undefined ? {} : { text: boundedText(raw.text, MAX_TEXT, op, "attributes.shape.text") }),
  };
}

function parseImage(raw: Dict, op: string): XlsxVisualImage {
  onlyKeys(raw, ["mediaType", "base64"], op, "attributes.image");
  const mediaType = oneOf(raw.mediaType, XLSX_VISUAL_IMAGE_TYPES, op, "attributes.image.mediaType");
  const base64 = str(raw.base64, op, "attributes.image.base64");
  const maxLength = Math.ceil(XLSX_VISUAL_MAX_IMAGE_BYTES / 3) * 4;
  if (base64.length === 0 || base64.length % 4 !== 0 || !BASE64.test(base64)) {
    throw new XlsxOpError(op, "attributes.image.base64", "padded base64 required");
  }
  if (base64.length > maxLength) {
    throw new XlsxOpError(op, "attributes.image.base64", `a picture may be at most ${XLSX_VISUAL_MAX_IMAGE_BYTES} bytes`, true);
  }
  return { mediaType, base64 };
}

export function parseSetVisual(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  onlyKeys(a, ["id", "file", "anchor", "chart", "shape", "image"], op, "attributes");
  if (a.file !== undefined) {
    if (a.id !== undefined || a.chart !== undefined || a.shape !== undefined || a.image !== undefined) {
      throw new XlsxOpError(op, "attributes", "a file visual takes only file and anchor");
    }
    return [{ kind: FILE_MOVE_OP_KIND, sheetName, file: parseFileIndex(a.file, op), anchor: parseAnchor(a.anchor, op) }];
  }
  const id = parseId(a.id, op);
  const anchor = parseAnchor(a.anchor, op);
  const bodies = (["chart", "shape", "image"] as const).filter((key) => a[key] !== undefined);
  if (bodies.length === 0) return [{ kind: VISUAL_MOVE_OP_KIND, sheetName, id, anchor }];
  if (bodies.length !== 1) throw new XlsxOpError(op, "attributes", "at most one of chart, shape or image");
  const [body] = bodies;
  const raw = a[body as string];
  if (!isDict(raw)) throw new XlsxOpError(op, "attributes." + String(body), "object required");
  const content =
    body === "chart" ? { chart: parseChart(raw, op) } : body === "shape" ? { shape: parseShape(raw, op) } : { image: parseImage(raw, op) };
  return [{ kind: VISUAL_SET_OP_KIND, sheetName, id, anchor, ...content }];
}

export function parseRemoveVisual(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  onlyKeys(a, ["id", "file"], op, "attributes");
  if (a.file !== undefined) {
    if (a.id !== undefined) throw new XlsxOpError(op, "attributes", "either id or file, not both");
    return [{ kind: FILE_REMOVE_OP_KIND, sheetName, file: parseFileIndex(a.file, op) }];
  }
  return [{ kind: VISUAL_REMOVE_OP_KIND, sheetName, id: parseId(a.id, op) }];
}

/** Apply one visual op to the pending list (the model's journal): a set
 *  replaces the entry with the same sheet + id in place or appends it, a move
 *  replaces only its anchor, a remove drops it. Returns the next list; the
 *  input is never mutated. */
export function foldXlsxVisualOp(visuals: readonly XlsxVisualEntry[], op: XlsxVisualOp): XlsxVisualEntry[] {
  if (op.kind === FILE_MOVE_OP_KIND || op.kind === FILE_REMOVE_OP_KIND) return foldFileVisualOp(visuals, op);
  const index = visuals.findIndex((visual) => visual.kind === VISUAL_SET_OP_KIND && visual.sheetName === op.sheetName && visual.id === op.id);
  if (op.kind === VISUAL_REMOVE_OP_KIND) return index < 0 ? [...visuals] : visuals.filter((_, at) => at !== index);
  if (op.kind === VISUAL_MOVE_OP_KIND) {
    if (index < 0) throw new XlsxOpError(VISUAL_SET_OP_KIND, "attributes", "an anchor-only set_visual needs the visual's insert earlier in this session");
    return visuals.map((visual, at) => (at === index ? { ...visual, anchor: op.anchor } : visual));
  }
  if (index < 0) return [...visuals, op];
  return visuals.map((visual, at) => (at === index ? op : visual));
}

function foldFileVisualOp(visuals: readonly XlsxVisualEntry[], op: XlsxFileVisualMoveOp | XlsxFileVisualRemoveOp): XlsxVisualEntry[] {
  const index = visuals.findIndex((visual) => visual.kind === "file_visual" && visual.sheetName === op.sheetName && visual.file === op.file);
  const previous = index < 0 ? undefined : (visuals[index] as XlsxFileVisualEntry);
  // A move after a delete restores the visual (the editor's undo of a delete);
  // a second delete, like any other edit of a deleted visual, is refused.
  if (previous?.remove && op.kind !== FILE_MOVE_OP_KIND) {
    throw new XlsxOpError(VISUAL_REMOVE_OP_KIND, "attributes.file", "this file visual was deleted earlier in this session");
  }
  const next: XlsxFileVisualEntry = op.kind === FILE_MOVE_OP_KIND
    ? { kind: "file_visual", sheetName: op.sheetName, file: op.file, anchor: op.anchor }
    : { kind: "file_visual", sheetName: op.sheetName, file: op.file, remove: true };
  if (index < 0) return [...visuals, next];
  return visuals.map((visual, at) => (at === index ? next : visual));
}

/** The gateway's `visualEdits` list for the file visuals this session moved
 *  or deleted. `drawingPathOf` resolves a CURRENT sheet name to its drawing
 *  part in the base package; a sheet without one cannot hold a file visual. */
export function groupXlsxFileVisualEdits(visuals: readonly XlsxVisualEntry[], drawingPathOf: (sheetName: string) => string | null): XlsxWorkbookVisualEdit[] {
  return visuals.flatMap((visual): XlsxWorkbookVisualEdit[] => {
    if (visual.kind !== "file_visual") return [];
    const drawingPath = drawingPathOf(visual.sheetName);
    if (drawingPath === null) throw new XlsxOpError(VISUAL_SET_OP_KIND, "attributes.file", `sheet "${visual.sheetName}" has no drawing in the file`);
    if (visual.remove || visual.anchor === undefined) return [{ drawingPath, drawingIndex: visual.file, remove: true }];
    return [{ drawingPath, drawingIndex: visual.file, anchor: { ...visual.anchor } }];
  });
}

/** A sheet reference prefix, always quoted (valid in Excel for any name). */
const quotedSheet = (name: string): string => "'" + name.replace(/'/g, "''") + "'!";

function renamedRef(ref: string | undefined, previous: string, next: string): string | undefined {
  if (ref === undefined) return undefined;
  const escaped = previous.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return ref
    .split(quotedSheet(previous))
    .join(quotedSheet(next))
    .replace(new RegExp("(^|[^A-Za-z0-9_.'!])" + escaped + "!", "g"), (_match, lead: string) => lead + quotedSheet(next));
}

/** A sheet rename for the visual journal: entries on `previous` move to
 *  `next`, and every session chart's series refs that name `previous` follow
 *  it, so a saved chart never points at a sheet that no longer exists. */
export function renameXlsxVisualSheet(visuals: readonly XlsxVisualEntry[], previous: string, next: string): XlsxVisualEntry[] {
  return visuals.map((visual) => {
    const moved = visual.sheetName === previous ? { ...visual, sheetName: next } : visual;
    if (moved.kind !== VISUAL_SET_OP_KIND || moved.chart === undefined) return moved;
    const series = moved.chart.series.map((entry) => {
      const valuesRef = renamedRef(entry.valuesRef, previous, next);
      const categoriesRef = renamedRef(entry.categoriesRef, previous, next);
      return { ...entry, ...(valuesRef === undefined ? {} : { valuesRef }), ...(categoriesRef === undefined ? {} : { categoriesRef }) };
    });
    return { ...moved, chart: { ...moved.chart, series } };
  });
}

/** The gateway's `visualAdditions` list, in first-insert order. */
export function groupXlsxVisualAdditions(visuals: readonly XlsxVisualEntry[]): XlsxSheetVisualAddition[] {
  return visuals.filter((visual): visual is XlsxVisualSetOp => visual.kind === VISUAL_SET_OP_KIND).map((visual) => ({
    sheetName: visual.sheetName,
    anchor: { ...visual.anchor },
    ...(visual.chart === undefined ? {} : { chart: structuredClone(visual.chart) }),
    ...(visual.shape === undefined ? {} : { shape: { ...visual.shape } }),
    ...(visual.image === undefined ? {} : { image: { ...visual.image } }),
  }));
}

/** A row/column insert or delete as the visual journal sees it. */
export interface XlsxVisualStructuralShift {
  readonly kind: "insert_rows" | "remove_rows" | "insert_cols" | "remove_cols";
  readonly index: number;
  readonly count: number;
}

/** One anchor mark after a shift: the gateway's moveAnchorMark
 *  (xlsx-structure.ts shiftDrawingAnchors). A mark inside a deleted band
 *  clamps to the band's start and loses its offset. */
function shiftMark(cell: number, offset: number, shift: XlsxVisualStructuralShift): { cell: number; offset: number } {
  if (shift.kind === "insert_rows" || shift.kind === "insert_cols") {
    return { cell: cell >= shift.index ? cell + shift.count : cell, offset };
  }
  const end = shift.index + shift.count - 1;
  if (cell > end) return { cell: cell - shift.count, offset };
  if (cell >= shift.index) return { cell: shift.index, offset: 0 };
  return { cell, offset };
}

/** An anchor after a row/column insert or delete on its sheet, exactly as
 *  the gateway rewrites a drawing anchor already in the file. */
export function shiftXlsxVisualAnchor(anchor: XlsxVisualAnchor, shift: XlsxVisualStructuralShift): XlsxVisualAnchor {
  if (shift.kind === "insert_rows" || shift.kind === "remove_rows") {
    const from = shiftMark(anchor.fromRow, anchor.fromRowOffset, shift);
    const to = shiftMark(anchor.toRow, anchor.toRowOffset, shift);
    return { ...anchor, fromRow: from.cell, fromRowOffset: from.offset, toRow: to.cell, toRowOffset: to.offset };
  }
  const from = shiftMark(anchor.fromColumn, anchor.fromColumnOffset, shift);
  const to = shiftMark(anchor.toColumn, anchor.toColumnOffset, shift);
  return { ...anchor, fromColumn: from.cell, fromColumnOffset: from.offset, toColumn: to.cell, toColumnOffset: to.offset };
}

/** The visual journal after a row/column insert or delete on `sheetName`:
 *  pending session visuals and file-visual moves keep FINAL coordinates, so
 *  a later structural op shifts them like the gateway shifts the file's own
 *  anchors (which it does before writing additions and edits). */
export function shiftXlsxVisualEntries(visuals: readonly XlsxVisualEntry[], sheetName: string, shift: XlsxVisualStructuralShift): XlsxVisualEntry[] {
  return visuals.map((visual) => {
    if (visual.sheetName !== sheetName || visual.anchor === undefined) return visual;
    return { ...visual, anchor: shiftXlsxVisualAnchor(visual.anchor, shift) };
  });
}
