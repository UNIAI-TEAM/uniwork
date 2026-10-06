// B6 (UNI-926): the hyperlink + note command vocabulary and the A1 helpers the
// Insert-tab group uses. Hyperlinks ride a UniWork-registered renderer command
// (the pinned Univer 0.25.1 has no spreadsheet hyperlink command); notes ride
// the pinned sheets-note `sheet.command.update-note`.

export const XLSX_HYPERLINK_COMMAND = "uniwork.command.set-hyperlink";
export const XLSX_NOTE_COMMAND = "sheet.command.update-note";

/** Parse an A1 address ("B5", "$B$5") into 0-based row/column, or null. */
export function parseA1Address(address: string): { row: number; column: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$/.exec(address.trim());
  if (!match) return null;
  let column = 0;
  for (const ch of (match[1] ?? "").toUpperCase()) column = column * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(match[2]) - 1;
  if (row < 0 || row >= 1_048_576 || column < 1 || column > 16_384) return null;
  return { row, column: column - 1 };
}
