"use client";

import { ArrowDownToLine, ArrowUpToLine, Columns3, Rows3 } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { addressParts } from "../xlsx-editor-model";
import type { XlsxSelection } from "../types";
import { XLSX_RANGE_TYPE, type XlsxRangeType } from "../selection-mapping";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XLSX_SMALL_BUTTON_CLASS } from "./group-layout";

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

/** Default Univer grid size: without a range type (fallback surface,
 *  host-set selections), a selection spanning it from the first row/column
 *  is read as a whole-column/whole-row selection. */
const WHOLE_COLUMN_ROWS = 1000;
const WHOLE_ROW_COLUMNS = 26;

/** How many rows/columns the "insert before" commands default to. Excel
 *  inserts the selection's own span on that axis, but with whole columns
 *  selected the row span is the entire sheet (and vice versa), which is never
 *  what an Insert-Rows click means: that axis falls back to one. The grid's
 *  range type decides exactly; a NORMAL range keeps both spans however wide. */
export function insertCounts(span: XlsxSelectionSpan, rangeType?: XlsxRangeType): { rows: number; columns: number } {
  if (rangeType !== undefined) {
    const wholeColumns = rangeType === XLSX_RANGE_TYPE.COLUMN || rangeType === XLSX_RANGE_TYPE.ALL;
    const wholeRows = rangeType === XLSX_RANGE_TYPE.ROW || rangeType === XLSX_RANGE_TYPE.ALL;
    return { rows: wholeColumns ? 1 : span.rows, columns: wholeRows ? 1 : span.columns };
  }
  const wholeColumns = span.startRow === 0 && span.rows >= WHOLE_COLUMN_ROWS;
  const wholeRows = span.startColumn === 0 && span.columns >= WHOLE_ROW_COLUMNS;
  return { rows: wholeColumns && !wholeRows ? 1 : span.rows, columns: wholeRows && !wholeColumns ? 1 : span.columns };
}

/** Digits only, 1..XLSX_STRUCTURE_MAX_COUNT; null keeps the last good count. */
export function normalizeRowColCount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed >= 1 && parsed <= XLSX_STRUCTURE_MAX_COUNT ? parsed : null;
}

/** One labelled insert command: icon + the full command text, which is also
 *  its accessible name and tooltip (design review X2: no unlabeled cluster). */
function InsertButton({ label, icon, blocked, testId, onClick }: {
  label: string;
  icon: ReactNode;
  blocked: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      className={XLSX_SMALL_BUTTON_CLASS}
      title={label}
      aria-disabled={blocked || undefined}
      data-testid={testId}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

/** Home > Cells > "Insert rows/columns" (design review X2, Excel's Cells >
 *  Insert): a count per axis and the four labelled insert commands. The count
 *  drives every insert: the "after" buttons ride Univer's multi-after
 *  commands, since insert-row-after / insert-col-after ignore params and
 *  insert the selection's own span. Deleting lives in the sibling Delete
 *  menu. `onDone` closes the menu hosting the form after a command runs. */
export function XlsxStructureInsertGroup({ readOnly = false, selection, commands, onDone }: XlsxToolbarGroupProps & { onDone?: () => void }) {
  const { t } = useTranslation();
  const rowCountId = useId();
  const colCountId = useId();
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || !span;
  const defaults = span ? insertCounts(span, selection?.rangeType) : null;
  const rowSpan = defaults?.rows ?? 0;
  const colSpan = defaults?.columns ?? 0;
  const [rowCountDraft, setRowCountDraft] = useState(() => String(rowSpan > 0 ? rowSpan : 1));
  const [colCountDraft, setColCountDraft] = useState(() => String(colSpan > 0 ? colSpan : 1));

  useEffect(() => {
    if (rowSpan > 0) setRowCountDraft(String(rowSpan));
  }, [rowSpan]);
  useEffect(() => {
    if (colSpan > 0) setColCountDraft(String(colSpan));
  }, [colSpan]);

  const rowCount = normalizeRowColCount(rowCountDraft) ?? defaults?.rows ?? 1;
  const colCount = normalizeRowColCount(colCountDraft) ?? defaults?.columns ?? 1;
  const run = (id: string, params?: unknown) => () => {
    if (blocked) return;
    fireCommand(commands, id, params);
    onDone?.();
  };
  const countField = (id: string, labelKey: string, icon: ReactNode, draft: string, setDraft: (value: string) => void, settled: number) => (
    <div className="flex items-center gap-1.5 px-1.5">
      {icon}
      <label htmlFor={id} className="flex-1 text-caption text-muted-foreground">{t(labelKey)}</label>
      <Input
        id={id}
        className="h-6 w-16 px-1 text-center text-caption"
        inputMode="numeric"
        disabled={blocked}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setDraft(String(settled))}
      />
    </div>
  );

  return (
    <div className="flex w-60 flex-col gap-1" data-testid="xlsx-insert-rows-cols">
      {countField(rowCountId, "office.xlsx.structure.rowCount", <Rows3 aria-hidden className="size-4 shrink-0 text-muted-foreground" />, rowCountDraft, setRowCountDraft, rowCount)}
      <InsertButton
        label={t("office.xlsx.structure.insertRowsAbove", { count: rowCount })}
        icon={<ArrowUpToLine aria-hidden />}
        blocked={blocked}
        testId="xlsx-cells-insert-rows-above"
        onClick={run("sheet.command.insert-row-before", { value: rowCount })}
      />
      <InsertButton
        label={t("office.xlsx.structure.insertRowsBelow")}
        icon={<ArrowDownToLine aria-hidden />}
        blocked={blocked}
        testId="xlsx-cells-insert-rows-below"
        onClick={run("sheet.command.insert-multi-rows-after", { value: rowCount })}
      />
      <div className="my-0.5 border-t border-border" />
      {countField(colCountId, "office.xlsx.structure.colCount", <Columns3 aria-hidden className="size-4 shrink-0 text-muted-foreground" />, colCountDraft, setColCountDraft, colCount)}
      <InsertButton
        label={t("office.xlsx.structure.insertColsLeft", { count: colCount })}
        icon={<ArrowUpToLine aria-hidden className="-rotate-90" />}
        blocked={blocked}
        testId="xlsx-cells-insert-cols-left"
        onClick={run("sheet.command.insert-col-before", { value: colCount })}
      />
      <InsertButton
        label={t("office.xlsx.structure.insertColsRight")}
        icon={<ArrowDownToLine aria-hidden className="-rotate-90" />}
        blocked={blocked}
        testId="xlsx-cells-insert-cols-right"
        onClick={run("sheet.command.insert-multi-cols-right", { value: colCount })}
      />
    </div>
  );
}
