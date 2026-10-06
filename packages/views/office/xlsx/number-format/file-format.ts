import { useEffect, useState } from "react";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { addressParts } from "../xlsx-editor-model";

/** The number-format code the opened file stores for the active cell, read from
 *  the render model the host serves (cell style index -> style `numberFormat`).
 *  The format box falls back to it when nothing was applied from the ribbon in
 *  this session, so a reopened file shows its real format. Null is General (no
 *  format, "General", or an unreadable cell). */
export function useFileNumberFormat(context: XlsxToolbarGroupProps): string | null {
  const { host, selection, sheetName, resolveSheetId } = context;
  const [found, setFound] = useState<{ readonly key: string; readonly pattern: string | null } | null>(null);
  const address = selection?.address ?? null;
  const sheet = sheetName ?? selection?.sheet ?? null;
  const key = host && address && sheet ? `${host.file.sessionId}|${sheet}!${address}` : null;

  useEffect(() => {
    if (!host || !address || !sheet || key === null) return;
    const cell = addressParts(address);
    const sheetId = resolveSheetId?.(sheet) ?? host.file.sheets.find((candidate) => candidate.name === sheet)?.id;
    if (!cell || sheetId === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await host.readRange({
          sessionId: host.file.sessionId,
          sheetId,
          range: { startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column },
        });
        const styleIndex = result?.cells.find((entry) => entry.row === cell.row && entry.column === cell.column)?.styleIndex;
        const code = styleIndex === undefined ? undefined : host.file.styles[styleIndex]?.numberFormat;
        const pattern = code === undefined || code === "" || /^general$/i.test(code) ? null : code;
        if (!cancelled) setFound({ key, pattern });
      } catch {
        // A failed read leaves the box on General.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [host, address, sheet, key, resolveSheetId]);

  return found !== null && found.key === key ? found.pattern : null;
}
