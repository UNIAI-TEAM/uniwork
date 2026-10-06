"use client";

// Wave B / B4 (UNI-926): the Advanced Filter dialog. Mounted by the XLSX
// editor (its column provider needs the renderer host for the bounded header
// read); the Data-tab group only opens it. Criteria rows map to the pinned
// `sheet.command.set-filter-criteria` params and apply through the toolbar's
// one command port, so the filter model change journals through the same path
// the header filter panel uses.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { addressParts, columnLabel } from "../xlsx-editor-model";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxSelection } from "../types";
import {
  filterCriteriaOperations,
  selectionFilterArea,
  XLSX_FILTER_MAX_COLUMNS,
  XLSX_FILTER_MAX_ROWS,
  XLSX_FILTER_OPERATORS,
  XLSX_FILTER_SET_CRITERIA_COMMAND,
  XLSX_FILTER_SET_RANGE_COMMAND,
  type XlsxFilterCriterionRow,
} from "./filter-commands";

export interface XlsxAdvancedFilterDialogProps {
  documentKey: string;
  host: XlsxGridHostPort;
  commands: XlsxToolbarCommands;
  selection: XlsxSelection | null;
  readOnly?: boolean;
  onClose: () => void;
}

interface XlsxFilterColumnOption {
  column: number;
  label: string;
}

type ColumnState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; columns: XlsxFilterColumnOption[] };

/** What the selection points at: the filter area the dialog can establish and
 *  the header row its column labels come from. */
function selectionAreaOf(selection: XlsxSelection | null) {
  if (!selection) return null;
  const from = addressParts(selection.address);
  const to = selection.endAddress ? addressParts(selection.endAddress) : from;
  if (!from || !to) return null;
  return { sheet: selection.sheet, ...selectionFilterArea(from, to) };
}

/** Advanced Filter over the selected list: one criteria row per (column,
 *  operator, value), mapped to `set-filter-criteria` commands — one per
 *  column, at most two conditions each (OOXML). Applying first establishes the
 *  autoFilter over the selection when none exists yet (the pinned
 *  set-filter-range command refuses when one does, which is the no-op case). */
export function XlsxAdvancedFilterDialog({
  documentKey,
  host,
  commands,
  selection,
  readOnly = false,
  onClose,
}: XlsxAdvancedFilterDialogProps) {
  const { t } = useTranslation();
  const [columnsState, setColumnsState] = useState<ColumnState>({ kind: "loading" });
  const [rows, setRows] = useState<XlsxFilterCriterionRow[]>([]);
  const [join, setJoin] = useState<"and" | "or">("and");
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);
  const area = useMemo(() => selectionAreaOf(selection), [selection]);
  const sheet = useMemo(
    () => (area === null ? undefined : host.file.sheets.find((candidate) => candidate.name === area.sheet)),
    [area, host],
  );

  useEffect(() => {
    const token = ++tokenRef.current;
    if (area === null || sheet === undefined) {
      setColumnsState({ kind: "unavailable" });
      return undefined;
    }
    setColumnsState({ kind: "loading" });
    const endColumn = Math.min(area.endColumn, area.startColumn + XLSX_FILTER_MAX_COLUMNS - 1);
    void host
      .readRange({
        sessionId: host.file.sessionId,
        sheetId: sheet.id,
        range: { startRow: area.startRow, endRow: area.startRow, startColumn: area.startColumn, endColumn },
      })
      .then((result) => {
        if (tokenRef.current !== token) return;
        const header = new Map(
          result.cells.filter((cell) => cell.row === area.startRow).map((cell) => [cell.column, cell.value]),
        );
        const columns: XlsxFilterColumnOption[] = [];
        for (let column = area.startColumn; column <= endColumn; column += 1) {
          const value = header.get(column);
          columns.push({
            column,
            label: typeof value === "string" && value.length > 0 ? value : columnLabel(column),
          });
        }
        setColumnsState({ kind: "ready", columns });
      })
      .catch(() => {
        if (tokenRef.current === token) setColumnsState({ kind: "unavailable" });
      });
    return () => {
      if (tokenRef.current === token) tokenRef.current += 1;
    };
  }, [area, documentKey, host, sheet]);

  const columns = useMemo(
    () => (columnsState.kind === "ready" ? columnsState.columns : []),
    [columnsState],
  );

  // Seed one empty criteria row once the column list is known.
  useEffect(() => {
    if (columns.length === 0) return;
    setRows((current) => (current.length > 0 ? current : [{ column: columns[0]!.column, operator: "equal", value: "" }]));
  }, [columns]);

  const updateRow = (index: number, patch: Partial<XlsxFilterCriterionRow>) => {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
    setError(null);
  };
  const apply = () => {
    if (readOnly || area === null || sheet === undefined || columns.length === 0) return;
    let operations;
    try {
      operations = filterCriteriaOperations(rows, join);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      setError(
        message === "filter_too_many_conditions"
          ? t("office.xlsx.filter.dialog.tooManyConditions")
          : t("office.xlsx.filter.dialog.valueRequired"),
      );
      return;
    }
    void (async () => {
      try {
        const unitId = `file-${host.file.sha256}`;
        const range = {
          startRow: area.startRow,
          endRow: area.endRow,
          startColumn: area.startColumn,
          endColumn: area.endColumn,
        };
        // Establish the filter over the selection when none exists; the command
        // refuses (false) when a filter already exists - the criteria below then
        // apply to it. A one-row selection has no data row, so no filter range.
        // Fire-and-forget, but rejection-safe: a rejected dispatch must not
        // surface as an unhandled rejection.
        if (range.endRow > range.startRow) {
          void Promise.resolve(commands.execute(XLSX_FILTER_SET_RANGE_COMMAND, { unitId, subUnitId: sheet.id, range })).catch(() => false);
        }
        // Every criteria command still dispatches; the port resolves a real
        // boolean (a rejection resolves false), so the failed set is non-empty
        // exactly when a command did not run.
        const applied = await Promise.all(
          operations.map((operation) =>
            Promise.resolve(commands.execute(XLSX_FILTER_SET_CRITERIA_COMMAND, { unitId, subUnitId: sheet.id, ...operation })).catch(() => false),
          ),
        );
        const failed = applied.filter((result) => !result);
        if (failed.length > 0) {
          setError(t("office.xlsx.filter.dialog.applyFailed"));
          return;
        }
        onClose();
      } catch {
        setError(t("office.xlsx.filter.dialog.applyFailed"));
      }
    })();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="xlsx-advanced-filter" closeLabel={t("office.xlsx.filter.dialog.close")}>
        <DialogHeader>
          <DialogTitle>{t("office.xlsx.filter.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {columnsState.kind === "loading" ? (
            <p className="text-caption text-muted-foreground" role="status" data-testid="xlsx-filter-loading">
              {t("office.xlsx.filter.dialog.reading")}
            </p>
          ) : null}
          {columnsState.kind === "unavailable" ? (
            <p className="text-caption text-muted-foreground" role="status" data-testid="xlsx-filter-unavailable">
              {t("office.xlsx.filter.dialog.noSelection")}
            </p>
          ) : null}
          {columns.length > 0 ? (
            <>
              {rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <div className="grid min-w-32 flex-1 gap-1">
                    <Label htmlFor={`xlsx-filter-column-${index}`} className="text-caption font-medium">
                      {t("office.xlsx.filter.dialog.column")}
                    </Label>
                    <Select
                      id={`xlsx-filter-column-${index}`}
                      aria-label={t("office.xlsx.filter.dialog.column")}
                      triggerVariant="subtle"
                      value={String(row.column)}
                      onValueChange={(value) => {
                        if (value !== null) updateRow(index, { column: Number(value) });
                      }}
                      items={columns.map((column) => ({ value: String(column.column), label: column.label }))}
                    />
                  </div>
                  <div className="grid min-w-28 flex-1 gap-1">
                    <Label htmlFor={`xlsx-filter-operator-${index}`} className="text-caption font-medium">
                      {t("office.xlsx.filter.dialog.operator")}
                    </Label>
                    <Select
                      id={`xlsx-filter-operator-${index}`}
                      aria-label={t("office.xlsx.filter.dialog.operator")}
                      triggerVariant="subtle"
                      value={row.operator}
                      onValueChange={(value) => {
                        if (value !== null) updateRow(index, { operator: value });
                      }}
                      items={XLSX_FILTER_OPERATORS.map((operator) => ({
                        value: operator,
                        label: t(`office.xlsx.filter.operators.${operator}`),
                      }))}
                    />
                  </div>
                  <div className="grid min-w-28 flex-1 gap-1">
                    <Label htmlFor={`xlsx-filter-value-${index}`} className="text-caption font-medium">
                      {t("office.xlsx.filter.dialog.value")}
                    </Label>
                    <Input
                      id={`xlsx-filter-value-${index}`}
                      data-testid={`xlsx-filter-value-${index}`}
                      className="h-8"
                      value={row.value}
                      onChange={(event) => updateRow(index, { value: event.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("office.xlsx.filter.dialog.removeCondition")}
                    aria-disabled={rows.length <= 1 || undefined}
                    data-testid={`xlsx-filter-remove-${index}`}
                    onClick={() => {
                      if (rows.length <= 1) return;
                      setRows((current) => current.filter((_row, at) => at !== index));
                      setError(null);
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-disabled={rows.length >= XLSX_FILTER_MAX_ROWS || undefined}
                  data-testid="xlsx-filter-add-condition"
                  onClick={() => {
                    if (rows.length >= XLSX_FILTER_MAX_ROWS) return;
                    setRows((current) => [
                      ...current,
                      { column: columns[0]!.column, operator: "equal", value: "" },
                    ]);
                    setError(null);
                  }}
                >
                  <Plus aria-hidden />
                  {t("office.xlsx.filter.dialog.addCondition")}
                </Button>
                <span className="text-caption text-muted-foreground">{t("office.xlsx.filter.dialog.join")}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={join === "and"}
                  data-testid="xlsx-filter-join-and"
                  onClick={() => setJoin("and")}
                >
                  {t("office.xlsx.filter.dialog.and")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={join === "or"}
                  data-testid="xlsx-filter-join-or"
                  onClick={() => setJoin("or")}
                >
                  {t("office.xlsx.filter.dialog.or")}
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">{t("office.xlsx.filter.dialog.note")}</p>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-filter-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="xlsx-filter-cancel" onClick={onClose}>
            {t("office.xlsx.filter.dialog.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            aria-disabled={readOnly || columns.length === 0 || undefined}
            data-testid="xlsx-filter-apply"
            onClick={apply}
          >
            {t("office.xlsx.filter.dialog.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
