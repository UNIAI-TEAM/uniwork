// UNI-953 (visual undo): the editor-side history of moves, inserts and deletes
// of charts, pictures and shapes. The renderer's grid stack never sees them
// (they ride the edit channel, not the grid), so the ribbon's Undo/Redo
// consult this stack first. Each entry remembers how many grid undo steps
// existed when it was recorded, which orders it against grid edits: it is the
// next undo while the grid has taken no step since, and the next redo once the
// grid is back at that depth.
import { moveVisualOp, removeVisualOp, setVisualOp, type XlsxEditorVisual } from "./visual-model";

export type XlsxVisualHistoryEntry =
  | { readonly kind: "move"; readonly before: XlsxEditorVisual; readonly after: XlsxEditorVisual; readonly gridUndos: number }
  | { readonly kind: "insert"; readonly visual: XlsxEditorVisual; readonly gridUndos: number }
  | { readonly kind: "remove"; readonly visual: XlsxEditorVisual; readonly gridUndos: number };

export type XlsxVisualHistoryDirection = "undo" | "redo";

/** The handle (id) of the visual an entry is about. */
const entryVisualId = (entry: XlsxVisualHistoryEntry): string => (entry.kind === "move" ? entry.after.id : entry.visual.id);

/** The overlay list and wire op one step produces. */
export function applyVisualHistory(
  visuals: readonly XlsxEditorVisual[],
  entry: XlsxVisualHistoryEntry,
  direction: XlsxVisualHistoryDirection,
  sheetName: string,
): { next: XlsxEditorVisual[]; op: Record<string, unknown>; id: string } {
  const id = entryVisualId(entry);
  if (entry.kind === "move") {
    const target = direction === "undo" ? entry.before : entry.after;
    return { next: visuals.map((visual) => (visual.id === id ? { ...visual, anchor: target.anchor } : visual)), op: moveVisualOp(target, sheetName), id };
  }
  // An undone delete and a redone insert bring the visual back; the others take it away.
  const restore = (entry.kind === "remove") === (direction === "undo");
  // A file visual comes back through its file move (the anchor it had); a session one through its insert.
  if (restore) {
    const op = entry.visual.file === undefined ? setVisualOp(entry.visual, sheetName) : moveVisualOp(entry.visual, sheetName);
    return { next: visuals.some((visual) => visual.id === id) ? [...visuals] : [...visuals, entry.visual], op, id };
  }
  return { next: visuals.filter((visual) => visual.id !== id), op: removeVisualOp(entry.visual, sheetName), id };
}

/** An entry before the hook stamps the grid depth on it. */
export type XlsxVisualHistoryDraft =
  | Omit<Extract<XlsxVisualHistoryEntry, { kind: "move" }>, "gridUndos">
  | Omit<Extract<XlsxVisualHistoryEntry, { kind: "insert" | "remove" }>, "gridUndos">;
