// UNI-940 X02 (m3): a recovered draft re-emits its raw op stream (F4), so the
// set_visual / remove_visual ops it carries reach the next save. The overlay
// state is React-only; this folds the stream back into the visuals it holds
// so the editor can draw, move and delete them again instead of saving
// visuals the user cannot see. The engine (ops-visuals.ts) stays the
// validator: entries that are not well-formed visual ops are skipped here.
import type { XlsxEditorVisual } from "./visual-model";

type RecoveredVisual = Pick<XlsxEditorVisual, "id" | "anchor" | "chart" | "shape" | "image"> & { readonly sheetName: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function targetSheet(op: Record<string, unknown>): string | null {
  const target = op.target;
  return isRecord(target) && typeof target.sheet === "string" ? target.sheet : null;
}

/** A file visual's pending edit in a raw stream (UNI-953): its last anchor or its delete. */
export interface RecoveredFileEdit {
  readonly sheetName: string;
  readonly file: number;
  readonly anchor?: XlsxEditorVisual["anchor"] | undefined;
  readonly remove?: true | undefined;
}

/** The moves and deletes of visuals already in the file that a raw op
 *  stream carries, folded per (sheet, index) and keyed by the sheet's final
 *  name. A delete is final, like in the engine. */
export function fileEditsFromStream(stream: readonly unknown[]): RecoveredFileEdit[] {
  let edits: RecoveredFileEdit[] = [];
  for (const op of stream) {
    if (!isRecord(op)) continue;
    const sheet = targetSheet(op);
    if (sheet === null) continue;
    const attributes = isRecord(op.attributes) ? op.attributes : {};
    if (op.op === "rename_sheet" && typeof attributes.newName === "string") {
      const newName = attributes.newName;
      edits = edits.map((edit) => (edit.sheetName === sheet ? { ...edit, sheetName: newName } : edit));
      continue;
    }
    if (op.op === "remove_sheet") {
      edits = edits.filter((edit) => edit.sheetName !== sheet);
      continue;
    }
    const file = attributes.file;
    if ((op.op !== "set_visual" && op.op !== "remove_visual") || typeof file !== "number" || !Number.isInteger(file) || file < 0) continue;
    const index = edits.findIndex((edit) => edit.sheetName === sheet && edit.file === file);
    if (index >= 0 && edits[index]?.remove) continue;
    let next: RecoveredFileEdit;
    if (op.op === "remove_visual") next = { sheetName: sheet, file, remove: true };
    else if (isRecord(attributes.anchor)) next = { sheetName: sheet, file, anchor: attributes.anchor as unknown as XlsxEditorVisual["anchor"] };
    else continue;
    edits = index >= 0 ? edits.map((edit, at) => (at === index ? next : edit)) : [...edits, next];
  }
  return edits;
}

/** The session visuals a raw op stream leaves pending, in first-insert order,
 *  keyed by their sheet's final name (renames in the stream are followed). */
export function visualsFromStream(stream: readonly unknown[]): RecoveredVisual[] {
  let visuals: RecoveredVisual[] = [];
  for (const op of stream) {
    if (!isRecord(op)) continue;
    const sheet = targetSheet(op);
    if (sheet === null) continue;
    const attributes = isRecord(op.attributes) ? op.attributes : {};
    if (op.op === "rename_sheet" && typeof attributes.newName === "string") {
      const newName = attributes.newName;
      visuals = visuals.map((visual) => (visual.sheetName === sheet ? { ...visual, sheetName: newName } : visual));
      continue;
    }
    if (op.op === "remove_sheet") {
      visuals = visuals.filter((visual) => visual.sheetName !== sheet);
      continue;
    }
    if ((op.op !== "set_visual" && op.op !== "remove_visual") || typeof attributes.id !== "string") continue;
    const id = attributes.id;
    const index = visuals.findIndex((visual) => visual.id === id && visual.sheetName === sheet);
    if (op.op === "remove_visual") {
      if (index >= 0) visuals = visuals.filter((_, at) => at !== index);
      continue;
    }
    if (!isRecord(attributes.anchor)) continue;
    const anchor = attributes.anchor as unknown as XlsxEditorVisual["anchor"];
    const body = isRecord(attributes.chart)
      ? { chart: attributes.chart as unknown as NonNullable<XlsxEditorVisual["chart"]> }
      : isRecord(attributes.shape)
        ? { shape: attributes.shape as unknown as NonNullable<XlsxEditorVisual["shape"]> }
        : isRecord(attributes.image)
          ? { image: attributes.image as unknown as NonNullable<XlsxEditorVisual["image"]> }
          : null;
    if (body === null) {
      // A move: only a visual the stream already holds.
      if (index >= 0) visuals = visuals.map((visual, at) => (at === index ? { ...visual, anchor } : visual));
      continue;
    }
    const next: RecoveredVisual = { id, sheetName: sheet, anchor, ...body };
    visuals = index >= 0 ? visuals.map((visual, at) => (at === index ? next : visual)) : [...visuals, next];
  }
  return visuals;
}
