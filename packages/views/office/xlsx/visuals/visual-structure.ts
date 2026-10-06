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

/** Where the ops appended since `previous` start in `next`. A save trims the
 *  stream's head, so `next` may begin with a suffix of `previous`. */
export function appendedFrom(previous: readonly string[], next: readonly string[]): number {
  for (let trimmed = 0; trimmed <= previous.length; trimmed += 1) {
    const kept = previous.length - trimmed;
    if (kept > next.length) continue;
    let same = true;
    for (let at = 0; at < kept && same; at += 1) same = previous[trimmed + at] === next[at];
    if (same) return kept;
  }
  return 0;
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
