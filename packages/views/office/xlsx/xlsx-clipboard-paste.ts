// The writes of one paste (UNI-953): the planned values, styles and merges as
// grid commands that run as ONE undo step, or as one fallback edit batch, and
// the single clipboard read that feeds both flavours.

import { toA1Address } from "./xlsx-render-model-bridge";
import { cellEditOperation } from "./xlsx-editor-model";
import type { XlsxRichPastePlan } from "./xlsx-clipboard-rich";
import type { XlsxPasteStyle } from "./xlsx-clipboard-style";
import type { XlsxClipboardPort } from "./types";

/** Univer CellValueType: 1 string, 2 number, 3 boolean. */
const CELL_STRING = 1;
const CELL_NUMBER = 2;
const CELL_BOOLEAN = 3;

/** The renderer's typed-cell rule (shims/xlsx-renderer/cell-input.ts
 *  parseCellText, the formula bar's contract) as Univer cell data; a text
 *  number format (`@`) keeps the text as a string, like Excel, and a source
 *  number (rich paste) replaces its formatted display text. */
export function pasteCellData(text: string, style: XlsxPasteStyle | null, source: number | null = null): Record<string, unknown> {
  const cleared = { f: null, p: null, si: null };
  const withStyle = style ? { s: style } : {};
  if (style?.n?.pattern === "@") return { ...cleared, v: text === "" ? null : text, t: CELL_STRING, ...withStyle };
  if (text.startsWith("=")) return { ...cleared, f: text, v: null, ...withStyle };
  if (source !== null) return { ...cleared, v: source, t: CELL_NUMBER, ...withStyle };
  if (text === "") return { ...cleared, v: null, ...withStyle };
  if (text === "TRUE" || text === "FALSE") return { ...cleared, v: text === "TRUE" ? 1 : 0, t: CELL_BOOLEAN, ...withStyle };
  const number = Number(text);
  if (text.trim() !== "" && Number.isFinite(number)) return { ...cleared, v: number, t: CELL_NUMBER, ...withStyle };
  return { ...cleared, v: text, t: CELL_STRING, ...withStyle };
}

export interface XlsxPasteStep {
  readonly id: string;
  readonly params: Record<string, unknown>;
}

/** One set-range-values carrying every value with its style, then one merge
 *  command per merged area (`defaultMerge`: the covered cells were just
 *  written empty, so there is nothing to confirm). */
export function gridPasteSteps(
  unitId: string,
  subUnitId: string,
  start: { row: number; column: number },
  plainRows: readonly (readonly string[])[],
  plan: XlsxRichPastePlan | null,
): XlsxPasteStep[] {
  const value: Record<number, Record<number, Record<string, unknown>>> = {};
  plainRows.forEach((cells, rowIndex) => {
    const row: Record<number, Record<string, unknown>> = (value[start.row + rowIndex] = {});
    cells.forEach((text, columnIndex) => {
      row[start.column + columnIndex] = pasteCellData(text, plan?.styles[rowIndex]?.[columnIndex] ?? null, plan?.numbers[rowIndex]?.[columnIndex] ?? null);
    });
  });
  // The pasted rectangle: without it the pinned command reads the live
  // selection, and refuses when there is none.
  const range = {
    startRow: start.row, endRow: start.row + plainRows.length - 1,
    startColumn: start.column, endColumn: start.column + Math.max(0, ...plainRows.map((cells) => cells.length)) - 1,
  };
  return [
    { id: "sheet.command.set-range-values", params: { unitId, subUnitId, range, value } },
    ...(plan?.merges ?? []).map((area) => ({
      id: "sheet.command.add-worksheet-merge",
      params: { unitId, subUnitId, selections: [area], defaultMerge: true },
    })),
  ];
}

/** The fallback surface's paste: one set_cell per cell (value and style in
 *  the same op) plus one merge_cells per merged area, sent as one batch. */
export function fallbackPasteOps(
  sheet: string,
  start: { row: number; column: number },
  plainRows: readonly (readonly string[])[],
  plan: XlsxRichPastePlan | null,
): unknown[] {
  const ops: unknown[] = plainRows.flatMap((cells, rowIndex) => cells.map((text, columnIndex) => {
    const address = toA1Address(start.row + rowIndex, start.column + columnIndex);
    const style = plan?.styles[rowIndex]?.[columnIndex] ?? null;
    const source = plan?.numbers[rowIndex]?.[columnIndex] ?? null;
    const literal = style?.n?.pattern === "@" && text !== "" ? text : !text.startsWith("=") ? source : null;
    const op = literal === null
      ? cellEditOperation(sheet, address, text)
      : { op: "set_cell", target: { sheet, cell: address }, attributes: { value: literal } };
    return style ? { ...op, style } : op;
  }));
  for (const range of plan?.merges ?? []) ops.push({ op: "merge_cells", target: { sheet }, range });
  return ops;
}

async function flavour(item: ClipboardItem, type: string): Promise<string | null> {
  return item.types.includes(type) ? (await item.getType(type)).text() : null;
}

/** Both clipboard flavours from ONE async-clipboard read (NIT-1: a second
 *  read can prompt again in Firefox/Safari). The host port's readText is the
 *  fallback when the browser has no `read()`, refuses it, or the clipboard
 *  holds no plain text; the port stays the gate for whether paste exists. */
export async function readPasteClipboard(port: Required<Pick<XlsxClipboardPort, "readText">>): Promise<{ text: string; html: string }> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard?.read) {
    try {
      let text: string | null = null;
      let html = "";
      for (const item of await clipboard.read()) {
        text ??= await flavour(item, "text/plain");
        html ||= (await flavour(item, "text/html")) ?? "";
      }
      if (text !== null) return { text, html };
    } catch {
      // Denied or unsupported: the host's plain-text read still works.
    }
  }
  return { text: await port.readText(), html: "" };
}
