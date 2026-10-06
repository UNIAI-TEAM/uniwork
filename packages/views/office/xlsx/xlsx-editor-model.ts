import type { SaveCoordinatorState } from "@uniwork/core/office";
import type { XlsxCellState, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxEditorProps, XlsxOpenFailure, XlsxOpenOutcome } from "./types";
function isFailure(outcome: XlsxOpenOutcome): outcome is XlsxOpenFailure { return outcome.outcome === "failed"; }
export function isSnapshot(value: unknown): value is XlsxWorkbookSnapshot {
  if (!value || typeof value !== "object") return false;
  const sheets = (value as { sheets?: unknown }).sheets;
  return Array.isArray(sheets) && sheets.every((sheet) => sheet && typeof sheet === "object" && typeof (sheet as { name?: unknown }).name === "string");
}

export function cellText(cell: XlsxCellState | undefined): string {
  if (!cell) return "";
  if (cell.formula !== undefined) return cell.formula;
  return cell.value === null ? "" : String(cell.value);
}

export function cellEditOperation(sheet: string, address: string, text: string): { op: "set_cell"; target: { sheet: string; cell: string }; attributes: { value: XlsxCellState["value"] } | { formula: string } } {
  if (text.startsWith("=")) return { op: "set_cell", target: { sheet, cell: address }, attributes: { formula: text } };
  if (text === "") return { op: "set_cell", target: { sheet, cell: address }, attributes: { value: null } };
  if (text === "TRUE" || text === "FALSE") return { op: "set_cell", target: { sheet, cell: address }, attributes: { value: text === "TRUE" } };
  const number = Number(text);
  if (text.trim() !== "" && Number.isFinite(number)) return { op: "set_cell", target: { sheet, cell: address }, attributes: { value: number } };
  return { op: "set_cell", target: { sheet, cell: address }, attributes: { value: text } };
}

export function addressParts(address: string): { row: number; column: number } | null {
  const match = /^([A-Za-z]{1,3})([1-9][0-9]*)$/.exec(address);
  if (!match) return null;
  let column = 0;
  for (const char of match[1]!.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

export function columnLabel(column: number): string {
  let number = column + 1;
  let result = "";
  while (number > 0) {
    result = String.fromCharCode(65 + ((number - 1) % 26)) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

/** Review m-3: visuals stay frozen while a save runs AND while a failed
 *  save's outcome is still unknown (an ambiguous failure, or a failure after
 *  the commit step that was not a refusal, keeps the intent pending until a
 *  reconcile settles it; review-session m-2). A move made in that window could
 *  follow an insert that already committed, and the server refuses an
 *  anchor-only move whose insert is in the file. */
export function visualsFrozen(state: Pick<SaveCoordinatorState, "state" | "activeIntentId" | "error" | "outcomeUnknown">): boolean {
  if (state.state === "saving") return true;
  return state.activeIntentId !== null && (state.outcomeUnknown === true || state.error?.ambiguous === true);
}

export function snapshotForEditor<TSnapshot>(editor: XlsxEditorProps<TSnapshot>["editor"], outcome: XlsxOpenOutcome): XlsxWorkbookSnapshot | null {
  if (!isFailure(outcome) && isSnapshot(outcome.snapshot)) return outcome.snapshot;
  const candidate = editor.getWorkbookSnapshot?.();
  return isSnapshot(candidate) ? candidate : null;
}


