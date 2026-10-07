// UNI-953 X02 r2: a row/column insert or delete moves the visuals drawn over
// the grid at once. The editor's op stream (snapshot.pendingOps) is the
// source: the ops appended since the last look are scanned, and each
// structural op shifts the overlay anchors on its sheet with the engine's
// shiftXlsxVisualAnchor - the same rule the gateway applies to the file's
// drawing on save and the engine applies to pending visual ops - so the
// screen, the save and a reopen agree.
import { shiftXlsxVisualAnchor, type XlsxVisualStructuralShift } from "@uniwork/office-engine/xlsx";
import type { XlsxEditorVisual } from "./visual-model";

const SHIFT_KINDS: ReadonlySet<string> = new Set(["insert_rows", "remove_rows", "insert_cols", "remove_cols"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A comparable key per stream op; a picture insert keys by id and anchor
 *  so its bytes are not serialized on every look. */
export function streamOpKey(op: unknown): string {
  if (isRecord(op) && op.op === "set_visual" && isRecord(op.attributes) && op.attributes.image !== undefined) {
    return JSON.stringify(["set_visual", op.target, op.attributes.id, op.attributes.anchor]);
  }
  return JSON.stringify(op);
}

const keyCache = new WeakMap<object, string>();

/** The keys of a stream, each op serialized once: the stream is append-only
 *  and its ops are not mutated, so a key is cached per op object. */
export function streamOpKeys(stream: readonly unknown[]): string[] {
  return stream.map((op) => {
    if (typeof op !== "object" || op === null) return streamOpKey(op);
    let key = keyCache.get(op);
    if (key === undefined) {
      key = streamOpKey(op);
      keyCache.set(op, key);
    }
    return key;
  });
}

/** Where the ops appended since `previous` start in `next`: the length of the
 *  longest suffix of `previous` that is a prefix of `next` (a save trims the
 *  stream's head), 0 when none. KMP prefix function over next + sentinel +
 *  previous, so it is linear. */
export function appendedFrom(previous: readonly string[], next: readonly string[]): number {
  const n = next.length;
  const total = n + 1 + previous.length;
  // Index n is the sentinel; it equals nothing, so a border never crosses it.
  const same = (i: number, j: number): boolean => i !== n && j !== n && (i < n ? next[i] : previous[i - n - 1]) === (j < n ? next[j] : previous[j - n - 1]);
  const fail = new Array<number>(total).fill(0);
  for (let i = 1; i < total; i += 1) {
    let k = fail[i - 1] ?? 0;
    while (k > 0 && !same(i, k)) k = fail[k - 1] ?? 0;
    if (same(i, k)) k += 1;
    fail[i] = k;
  }
  return fail[total - 1] ?? 0;
}

/** One structural op of a stream segment, with the visuals a later op of
 *  the same segment already placed (their overlay state is newer). */
export interface XlsxOverlayShift {
  readonly sheetName: string;
  readonly shift: XlsxVisualStructuralShift;
  readonly laterIds: ReadonlySet<string>;
  readonly laterFiles: ReadonlySet<string>;
}

export function structuralShiftsOf(segment: readonly unknown[]): XlsxOverlayShift[] {
  const shifts: XlsxOverlayShift[] = [];
  segment.forEach((op, at) => {
    if (!isRecord(op) || typeof op.op !== "string" || !SHIFT_KINDS.has(op.op)) return;
    const target = isRecord(op.target) ? op.target : {};
    const attributes = isRecord(op.attributes) ? op.attributes : {};
    if (typeof target.sheet !== "string" || typeof attributes.index !== "number" || typeof attributes.count !== "number") return;
    const laterIds = new Set<string>();
    const laterFiles = new Set<string>();
    for (const later of segment.slice(at + 1)) {
      if (!isRecord(later) || (later.op !== "set_visual" && later.op !== "remove_visual") || !isRecord(later.attributes)) continue;
      const sheet = isRecord(later.target) && typeof later.target.sheet === "string" ? later.target.sheet : "";
      if (typeof later.attributes.id === "string") laterIds.add(later.attributes.id);
      if (typeof later.attributes.file === "number") laterFiles.add(`${sheet}:${later.attributes.file}`);
    }
    shifts.push({ sheetName: target.sheet, shift: { kind: op.op as XlsxVisualStructuralShift["kind"], index: attributes.index, count: attributes.count }, laterIds, laterFiles });
  });
  return shifts;
}

/** The overlay after the segment's structural ops. A visual placed by a
 *  later op of the segment is left alone, and an absolute anchor never moves. */
export function applyOverlayShifts(
  visuals: readonly XlsxEditorVisual[],
  shifts: readonly XlsxOverlayShift[],
  sheetIdOf: (sheetName: string) => string | undefined,
): XlsxEditorVisual[] {
  let next = [...visuals];
  for (const { sheetName, shift, laterIds, laterFiles } of shifts) {
    const sheetId = sheetIdOf(sheetName);
    if (sheetId === undefined) continue;
    next = next.map((visual) => {
      if (visual.sheetId !== sheetId || visual.position !== undefined) return visual;
      if (visual.file === undefined ? laterIds.has(visual.id) : laterFiles.has(`${sheetName}:${visual.file}`)) return visual;
      return { ...visual, anchor: shiftXlsxVisualAnchor(visual.anchor, shift) };
    });
  }
  return next;
}
