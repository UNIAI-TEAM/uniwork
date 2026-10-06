import { CellValueType, type ICellData } from "@univerjs/core";

/** Match the UniWork formula bar's scalar input contract. */
export function parseCellText(text: string): ICellData {
  const cleared = { f: null, p: null, si: null };
  if (text.startsWith("=")) return { ...cleared, f: text, v: null };
  if (text === "") return { ...cleared, v: null };
  if (text === "TRUE" || text === "FALSE") {
    return { ...cleared, v: text === "TRUE" ? 1 : 0, t: CellValueType.BOOLEAN };
  }
  const number = Number(text);
  if (text.trim() !== "" && Number.isFinite(number)) return { ...cleared, v: number, t: CellValueType.NUMBER };
  return { ...cleared, v: text, t: CellValueType.STRING };
}
