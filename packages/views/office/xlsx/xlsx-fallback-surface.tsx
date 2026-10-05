"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { cn } from "@uniwork/ui/lib/utils";
import { addressParts, cellText, columnLabel } from "./xlsx-editor-model";
import type { XlsxSelection } from "./types";

export interface XlsxFallbackSurfaceProps {
  sheet: XlsxWorkbookSnapshot["sheets"][number] | undefined;
  selection: XlsxSelection | null;
  onSelectCell: (next: XlsxSelection) => void;
}

/** The plain-table grid shown when no renderer host is mounted (snapshot only). */
export function XlsxFallbackSurface({ sheet, selection, onSelectCell }: XlsxFallbackSurfaceProps) {
  const { t } = useTranslation();
  const cells = useMemo(() => sheet?.cells ?? {}, [sheet]);
  const { maxRow, maxColumn } = useMemo(() => {
    let row = 0;
    let column = 0;
    for (const address of Object.keys(cells)) {
      const parts = addressParts(address);
      if (!parts) continue;
      row = Math.max(row, parts.row);
      column = Math.max(column, parts.column);
    }
    return { maxRow: row, maxColumn: column };
  }, [cells]);
  return (
    <div className="min-h-64 flex-1 overflow-auto bg-muted/20 p-3" data-testid="xlsx-workbook-surface">
      {sheet ? (
        <table className="border-collapse text-caption" aria-label={t("office.xlsx.surface.table", { sheet: sheet.name })}>
          <thead>
            <tr>
              <th className="sticky left-0 border border-border bg-muted px-2 py-1" aria-hidden />
              {Array.from({ length: maxColumn + 1 }, (_, column) => <th key={column} className="border border-border bg-muted px-3 py-1 font-medium">{columnLabel(column)}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRow + 1 }, (_, row) => (
              <tr key={row}>
                <th className="sticky left-0 border border-border bg-muted px-2 py-1 font-medium">{row + 1}</th>
                {Array.from({ length: maxColumn + 1 }, (_, column) => {
                  const address = `${columnLabel(column)}${row + 1}`;
                  const selected = selection?.sheet === sheet.name && selection.address === address;
                  return (
                    <td key={address} className={cn("min-w-24 border border-border bg-background p-0", selected && "ring-2 ring-primary ring-inset")}>
                      <button type="button" className="block min-h-8 w-full px-2 text-left" aria-label={`${sheet.name} ${address}`} aria-pressed={selected} data-testid={`xlsx-cell-${sheet.name}-${address}`} onClick={() => onSelectCell({ sheet: sheet.name, address })}>
                        {cellText(sheet.cells[address])}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-body text-muted-foreground">{t("office.xlsx.surface.ready")}</p>}
    </div>
  );
}
