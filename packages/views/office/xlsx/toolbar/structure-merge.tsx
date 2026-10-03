"use client";

import { Combine, TableCellsMerge, TableCellsSplit } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { selectionSpan } from "./structure-insert";
import type { XlsxToolbarGroupProps } from "./types";

/** The pinned Univer merge commands this group wires. Merge-all takes the
 *  whole selection as one merge; merge-horizontal is "merge across" (one
 *  merge per row of the selection, which the pinned command expands from the
 *  live selection); remove-worksheet-merge removes every merge the passed
 *  ranges intersect. All three are allowlisted in the renderer's command
 *  policy; the save journals them as `merge_cells`/`unmerge_cells` ops. */
export const XLSX_MERGE_ALL_COMMAND = "sheet.command.add-worksheet-merge-all";
export const XLSX_MERGE_ACROSS_COMMAND = "sheet.command.add-worksheet-merge-horizontal";
export const XLSX_UNMERGE_COMMAND = "sheet.command.remove-worksheet-merge";

/** Home tab: merge cells / merge across / unmerge on the current selection.
 *  Without a selection, or with a single cell, there is nothing to merge or
 *  unmerge, so every control is `aria-disabled` — never hidden; read-only and
 *  a missing commands port disable them the same way. Merge across is
 *  additionally disabled on a single-column selection, where each row would
 *  merge into itself (the pinned command filters those selections out — the
 *  button would be dead). The params mirror the selection for the policy gate
 *  and for unmerge (whose command reads `ranges`); the pinned merge family
 *  commands expand the live selection. */
export function XlsxStructureMergeGroup({ readOnly = false, selection, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || span === null || (span.rows === 1 && span.columns === 1);
  const acrossBlocked = blocked || (span !== null && span.columns === 1);
  const range = span === null
    ? null
    : { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn };

  const run = (inert: boolean, id: string, params: unknown) => {
    if (inert) return;
    commands?.execute(id, params);
  };

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.mergeCells")}
        aria-disabled={blocked || undefined}
        onClick={() => run(blocked, XLSX_MERGE_ALL_COMMAND, { selections: range === null ? [] : [range] })}
      >
        <TableCellsMerge aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.mergeAcross")}
        aria-disabled={acrossBlocked || undefined}
        onClick={() => run(acrossBlocked, XLSX_MERGE_ACROSS_COMMAND, { selections: range === null ? [] : [range] })}
      >
        <Combine aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.unmergeCells")}
        aria-disabled={blocked || undefined}
        onClick={() => run(blocked, XLSX_UNMERGE_COMMAND, { ranges: range === null ? [] : [range] })}
      >
        <TableCellsSplit aria-hidden />
      </Button>
    </>
  );
}
