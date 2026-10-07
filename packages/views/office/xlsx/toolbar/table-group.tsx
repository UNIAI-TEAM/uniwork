"use client";

// B9 (UNI-926): Insert-tab Table group. Create a table over the current
// selection (header row + data rows) through the pinned `sheet.command.add-table`.
// The name is the next free "TableN" across the whole workbook, so a
// file-native Table1 can never be reused; it shows on the contextual Table
// Design tab once the selection sits inside the table (design review X2: the
// name box belongs there, not on Insert). Removing a table lives on that tab
// too (Convert to range). Both run through the toolbar's one command port; the
// renderer policy stays the savability gate.

import { Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XlsxGroupBody, XlsxLargeButton, XlsxLargeLabel } from "./group-layout";
import { selectionSpan } from "./structure-insert";
import { nextTableName } from "./table-names";

/** Fires `add-table` over the selection with the next free name; false when
 *  the selection or the command port is missing (nothing is sent). Shared by
 *  Insert > Table and Home > Styles > Format as Table. */
export function createTableOverSelection({ readOnly = false, selection, commands, tables }: XlsxToolbarGroupProps): boolean {
  const span = selectionSpan(selection);
  if (readOnly || !commands || !span) return false;
  fireCommand(commands, "sheet.command.add-table", {
    range: { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn },
    name: nextTableName(tables),
  });
  return true;
}

export function XlsxTableGroup(context: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = context.readOnly === true || !context.commands || !selectionSpan(context.selection);
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.table.create")}
        title={t("office.xlsx.table.create")}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-table-create"
        onClick={() => { if (!blocked) createTableOverSelection(context); }}
      >
        <Table2 aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.table.create")}</XlsxLargeLabel>
      </XlsxLargeButton>
    </XlsxGroupBody>
  );
}
