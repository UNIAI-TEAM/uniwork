"use client";

import { ArrowDownToLine, ArrowUpToLine, Columns3, Rows3, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { addressParts } from "../xlsx-editor-model";
import type { XlsxSelection } from "../types";
import type { XlsxToolbarGroupProps } from "./types";

/** The insert commands' count ceiling (Univer's own menu cap), mirrored by
 *  the renderer policy's param validation. */
export const XLSX_STRUCTURE_MAX_COUNT = 10_000;

export interface XlsxSelectionSpan {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly rows: number;
  readonly columns: number;
}

/** The 0-based grid span the toolbar selection covers; null when the
 *  selection is absent or unreadable (then every control is disabled). */
export function selectionSpan(selection: XlsxSelection | null): XlsxSelectionSpan | null {
  if (!selection) return null;
  const first = addressParts(selection.address);
  const last = addressParts(selection.endAddress ?? selection.address);
  if (!first || !last) return null;
  const startRow = Math.min(first.row, last.row);
  const endRow = Math.max(first.row, last.row);
  const startColumn = Math.min(first.column, last.column);
  const endColumn = Math.max(first.column, last.column);
  return { startRow, endRow, startColumn, endColumn, rows: endRow - startRow + 1, columns: endColumn - startColumn + 1 };
}

/** Digits only, 1..XLSX_STRUCTURE_MAX_COUNT; null keeps the last good count. */
export function normalizeRowColCount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed >= 1 && parsed <= XLSX_STRUCTURE_MAX_COUNT ? parsed : null;
}

/** Insert tab: insert/delete rows and columns for the selection's span. The
 *  count input drives the "before" inserts; the "after" commands insert the
 *  selection's own height/width (Univer's semantics). */
export function XlsxStructureInsertGroup({ readOnly = false, selection, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || !span;
  const rowSpan = span?.rows ?? 0;
  const [countDraft, setCountDraft] = useState("1");

  useEffect(() => {
    if (rowSpan > 0) setCountDraft(String(rowSpan));
  }, [rowSpan]);

  const count = normalizeRowColCount(countDraft) ?? span?.rows ?? 1;
  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    commands?.execute(id, params);
  };
  const removeParams = span === null ? undefined : {
    range: { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn },
  };

  return (
    <>
      <Rows3 aria-hidden className="text-muted-foreground" />
      <Input
        className="h-7 w-11 px-1 text-center text-caption"
        inputMode="numeric"
        aria-label={t("office.xlsx.structure.rowCount")}
        disabled={blocked}
        value={countDraft}
        onChange={(event) => setCountDraft(event.target.value)}
        onBlur={() => setCountDraft(String(count))}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.insertRowsAbove", { count })}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.insert-row-before", { value: count })}
      >
        <ArrowUpToLine aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.insertRowsBelow")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.insert-row-after")}
      >
        <ArrowDownToLine aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.deleteRows")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.remove-row", removeParams)}
      >
        <Trash2 aria-hidden />
      </Button>
      <Columns3 aria-hidden className="text-muted-foreground" />
      <Input
        className="h-7 w-11 px-1 text-center text-caption"
        inputMode="numeric"
        aria-label={t("office.xlsx.structure.colCount")}
        disabled={blocked}
        value={countDraft}
        onChange={(event) => setCountDraft(event.target.value)}
        onBlur={() => setCountDraft(String(count))}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.insertColsLeft", { count })}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.insert-col-before", { value: count })}
      >
        <ArrowUpToLine aria-hidden className="-rotate-90" />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.insertColsRight")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.insert-col-after")}
      >
        <ArrowDownToLine aria-hidden className="-rotate-90" />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.deleteCols")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.remove-col", removeParams)}
      >
        <Trash2 aria-hidden />
      </Button>
    </>
  );
}
