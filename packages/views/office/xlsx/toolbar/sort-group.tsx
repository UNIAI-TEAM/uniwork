"use client";

// Wave A / A7 (UNI-926): Data-tab sort group. Sort ascending / descending fire
// the pinned `sheet.command.sort-range` command over the selection (single key
// = the selection's first column); the third control opens the group-owned
// Custom Sort dialog. Every action runs through the toolbar's one command port,
// so the sort journals through the same cell-edit path as manual typing and the
// renderer policy stays the savability gate. The dialog lives here, not in the
// editor, so this task touches no shared shell file.
//
// Op-limit guard: a sort rewrites every cell of the sorted range (rows x
// columns). The engine accepts at most 10,000 edit ops per save job, so a range
// above that is refused HERE, before the command runs - never partially sorted -
// with a vi+en message.

import { useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { addressParts } from "../xlsx-editor-model";
import type { XlsxSelection } from "../types";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XLSX_SMALL_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows, XlsxLargeButton, XlsxLargeLabel } from "./group-layout";
import {
  selectionSortRange,
  sortWithinOpLimit,
  XLSX_SORT_COMMAND,
  XLSX_SORT_MAX_OPS,
  type XlsxSortDirection,
  type XlsxSortRange,
} from "../sort/sort-commands";
import { XlsxCustomSortDialog } from "../sort/custom-sort-dialog";

/** The sort range the current selection spans, or null without one. */
function sortRangeOf(selection: XlsxSelection | null): XlsxSortRange | null {
  if (!selection) return null;
  const from = addressParts(selection.address);
  const to = selection.endAddress ? addressParts(selection.endAddress) : from;
  if (!from || !to) return null;
  return selectionSortRange(from, to);
}

export function XlsxSortGroup({
  readOnly = false,
  commands,
  selection,
  host,
  unitId,
  sheetName,
  resolveSheetId,
}: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [customOpen, setCustomOpen] = useState(false);
  const [limitError, setLimitError] = useState(false);
  const range = sortRangeOf(selection);
  const sheetId = sheetName ? resolveSheetId?.(sheetName) : undefined;
  const blocked = readOnly || !commands || range === null || sheetId === undefined || unitId == null;
  const canOpenCustom = blocked || !host;

  const run = (direction: XlsxSortDirection) => {
    setLimitError(false);
    if (blocked || range === null || sheetId === undefined) return;
    // Refuse before running: an over-budget sort is never dispatched, so the
    // sheet is never left half-sorted.
    if (sortWithinOpLimit(range) === null) {
      setLimitError(true);
      return;
    }
    // The pinned sort handler is async; the helper reports a refusal or
    // rejection without unmounting the toolbar.
    fireCommand(commands, XLSX_SORT_COMMAND, {
      unitId,
      subUnitId: sheetId,
      range: { ...range },
      orderRules: [{ type: direction, colIndex: range.startColumn }],
      hasTitle: false,
    });
  };

  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.sort.custom")}
        title={t("office.xlsx.sort.custom")}
        aria-haspopup="dialog"
        aria-disabled={canOpenCustom || undefined}
        data-testid="xlsx-sort-custom"
        onClick={() => {
          setLimitError(false);
          if (canOpenCustom) return;
          setCustomOpen(true);
        }}
      >
        <ArrowUpDown aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.sort.custom")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="xs"
            className={XLSX_SMALL_BUTTON_CLASS}
            title={t("office.xlsx.sort.ascending")}
            aria-disabled={blocked || undefined}
            data-testid="xlsx-sort-asc"
            onClick={() => run("asc")}
          >
            <ArrowUpAZ aria-hidden />
            {t("office.xlsx.sort.ascendingShort")}
          </Button>
        </XlsxGroupRow>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="xs"
            className={XLSX_SMALL_BUTTON_CLASS}
            title={t("office.xlsx.sort.descending")}
            aria-disabled={blocked || undefined}
            data-testid="xlsx-sort-desc"
            onClick={() => run("desc")}
          >
            <ArrowDownAZ aria-hidden />
            {t("office.xlsx.sort.descendingShort")}
          </Button>
        </XlsxGroupRow>
        {limitError ? (
          <p role="alert" className="max-w-40 text-caption leading-tight text-destructive" data-testid="xlsx-sort-limit-error">
            {t("office.xlsx.sort.limitExceeded", { limit: XLSX_SORT_MAX_OPS })}
          </p>
        ) : null}
      </XlsxGroupRows>
      {customOpen && host && commands ? (
        <XlsxCustomSortDialog
          documentKey={`${unitId ?? ""}:${sheetId ?? ""}`}
          host={host}
          commands={commands}
          selection={selection}
          readOnly={readOnly}
          onClose={() => setCustomOpen(false)}
        />
      ) : null}
    </XlsxGroupBody>
  );
}
