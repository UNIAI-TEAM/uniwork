"use client";

// Wave A / A7 (UNI-926): the Custom Sort dialog. Mounted by the XLSX editor
// (its column provider reads the selection's header row through the renderer
// host); the Data-tab group only opens it. It offers a single sort level - key
// column inside the selection, direction, and a "has header row" option - and
// applies through the toolbar's one command port, so the sort journals through
// the same cell-edit path as manual typing. Multi-level sort is out of scope.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { addressParts, columnLabel } from "../xlsx-editor-model";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxSelection } from "../types";
import {
  selectionSortRange,
  sortCommandParams,
  sortRangeIsSortable,
  sortWithinOpLimit,
  XLSX_SORT_COMMAND,
  XLSX_SORT_MAX_OPS,
  type XlsxSortDirection,
  type XlsxSortRange,
} from "./sort-commands";

export interface XlsxCustomSortDialogProps {
  documentKey: string;
  host: XlsxGridHostPort;
  commands: XlsxToolbarCommands;
  selection: XlsxSelection | null;
  readOnly?: boolean;
  onClose: () => void;
}

interface XlsxSortColumnOption {
  column: number;
  label: string;
}

type ColumnsState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; columns: XlsxSortColumnOption[] };

/** The sort rectangle the selection spans and the header row its column labels
 *  come from. */
function selectionAreaOf(selection: XlsxSelection | null): { sheet: string; range: XlsxSortRange } | null {
  if (!selection) return null;
  const from = addressParts(selection.address);
  const to = selection.endAddress ? addressParts(selection.endAddress) : from;
  if (!from || !to) return null;
  return { sheet: selection.sheet, range: selectionSortRange(from, to) };
}

/** Custom Sort over the selected list: one key column (inside the selection),
 *  a direction and a "has header row" flag, mapped to the pinned
 *  `sheet.command.sort-range` params. The op-limit guard refuses a range whose
 *  rows x columns would exceed the engine budget before any command runs. */
export function XlsxCustomSortDialog({
  documentKey,
  host,
  commands,
  selection,
  readOnly = false,
  onClose,
}: XlsxCustomSortDialogProps) {
  const { t } = useTranslation();
  const [columnsState, setColumnsState] = useState<ColumnsState>({ kind: "loading" });
  const [keyColumn, setKeyColumn] = useState<number | null>(null);
  const [direction, setDirection] = useState<XlsxSortDirection>("asc");
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);
  const area = useMemo(() => selectionAreaOf(selection), [selection]);
  const sortable = area !== null && sortRangeIsSortable(area.range);
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
    void host
      .readRange({
        sessionId: host.file.sessionId,
        sheetId: sheet.id,
        range: {
          startRow: area.range.startRow,
          endRow: area.range.startRow,
          startColumn: area.range.startColumn,
          endColumn: area.range.endColumn,
        },
      })
      .then((result) => {
        if (tokenRef.current !== token) return;
        const header = new Map(
          result.cells.filter((cell) => cell.row === area.range.startRow).map((cell) => [cell.column, cell.value]),
        );
        const columns: XlsxSortColumnOption[] = [];
        for (let column = area.range.startColumn; column <= area.range.endColumn; column += 1) {
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

  // Default the key column to the selection's first column once known.
  useEffect(() => {
    if (columns.length === 0) return;
    setKeyColumn((current) => (current === null ? columns[0]!.column : current));
  }, [columns]);

  const apply = () => {
    setError(null);
    if (readOnly || area === null || sheet === undefined || keyColumn === null || !sortable) return;
    if (sortWithinOpLimit(area.range) === null) {
      setError(t("office.xlsx.sort.limitExceeded", { limit: XLSX_SORT_MAX_OPS }));
      return;
    }
    try {
      const params = sortCommandParams(area.range, keyColumn, direction, hasHeaderRow);
      const applied = commands.execute(XLSX_SORT_COMMAND, {
        unitId: `file-${host.file.sha256}`,
        subUnitId: sheet.id,
        ...params,
      });
      if (applied === false) {
        setError(t("office.xlsx.sort.applyFailed"));
        return;
      }
      onClose();
    } catch {
      setError(t("office.xlsx.sort.applyFailed"));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="xlsx-custom-sort" closeLabel={t("office.xlsx.sort.dialog.close")}>
        <DialogHeader>
          <DialogTitle>{t("office.xlsx.sort.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {columnsState.kind === "loading" ? (
            <p className="text-caption text-muted-foreground" role="status" data-testid="xlsx-sort-loading">
              {t("office.xlsx.sort.dialog.reading")}
            </p>
          ) : null}
          {columnsState.kind === "unavailable" || !sortable ? (
            <p className="text-caption text-muted-foreground" role="status" data-testid="xlsx-sort-unavailable">
              {t("office.xlsx.sort.dialog.noSelection")}
            </p>
          ) : null}
          {columns.length > 0 && sortable ? (
            <>
              <div className="grid gap-1">
                <Label htmlFor="xlsx-sort-key" className="text-caption font-medium">
                  {t("office.xlsx.sort.dialog.keyColumn")}
                </Label>
                <Select
                  id="xlsx-sort-key"
                  aria-label={t("office.xlsx.sort.dialog.keyColumn")}
                  triggerVariant="subtle"
                  value={keyColumn === null ? "" : String(keyColumn)}
                  onValueChange={(value) => {
                    if (value !== null) setKeyColumn(Number(value));
                  }}
                  items={columns.map((column) => ({ value: String(column.column), label: column.label }))}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="xlsx-sort-direction" className="text-caption font-medium">
                  {t("office.xlsx.sort.dialog.direction")}
                </Label>
                <Select
                  id="xlsx-sort-direction"
                  aria-label={t("office.xlsx.sort.dialog.direction")}
                  triggerVariant="subtle"
                  value={direction}
                  onValueChange={(value) => {
                    if (value === "asc" || value === "desc") setDirection(value);
                  }}
                  items={[
                    { value: "asc", label: t("office.xlsx.sort.ascending") },
                    { value: "desc", label: t("office.xlsx.sort.descending") },
                  ]}
                />
              </div>
              <label className="flex items-center gap-2 text-caption">
                <Checkbox
                  checked={hasHeaderRow}
                  onCheckedChange={(checked) => setHasHeaderRow(checked === true)}
                  data-testid="xlsx-sort-header-row"
                />
                {t("office.xlsx.sort.dialog.hasHeaderRow")}
              </label>
              <p className="text-caption text-muted-foreground">{t("office.xlsx.sort.dialog.note")}</p>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-sort-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="xlsx-sort-cancel" onClick={onClose}>
            {t("office.xlsx.sort.dialog.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            aria-disabled={readOnly || keyColumn === null || !sortable || undefined}
            data-testid="xlsx-sort-apply"
            onClick={apply}
          >
            {t("office.xlsx.sort.dialog.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
