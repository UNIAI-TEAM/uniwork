"use client";

// B9 (UNI-926): Insert-tab Table group. Create a table over the current
// selection (header row + data rows) through the pinned `sheet.command.add-table`.
// The name field shows the next free "TableN" across the whole workbook and is
// sent with the command, so a file-native Table1 can never be reused. Removing
// a table lives on the contextual Table Design tab (Convert to range). Both run
// through the toolbar's one command port; the renderer policy stays the
// savability gate.

import { Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@uniwork/ui/components/ui/input";
import { useState } from "react";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XlsxGroupBody, XlsxGroupRow, XlsxGroupRows, XlsxLargeButton, XlsxLargeLabel } from "./group-layout";
import { selectionSpan } from "./structure-insert";
import { isValidTableName, nextTableName, tableNameTaken } from "./table-names";

export function XlsxTableGroup({ readOnly = false, selection, commands, tables }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const span = selectionSpan(selection);
  // `null` follows the proposed default (it advances after each create);
  // a string is what the user typed.
  const [draft, setDraft] = useState<string | null>(null);
  const name = (draft ?? nextTableName(tables)).trim();
  const nameOk = isValidTableName(name) && !tableNameTaken(tables, name);
  const frozen = readOnly || !commands;
  const blocked = frozen || !span || !nameOk;
  const create = () => {
    if (blocked || !span) return;
    fireCommand(commands, "sheet.command.add-table", {
      range: { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn },
      name,
    });
    setDraft(null);
  };
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.table.create")}
        title={t("office.xlsx.table.create")}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-table-create"
        onClick={create}
      >
        <Table2 aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.table.create")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Input
            className="h-6 w-24 rounded-sm px-1 text-caption"
            aria-label={t("office.xlsx.table.nameLabel")}
            title={nameOk ? t("office.xlsx.table.nameLabel") : t("office.xlsx.table.nameInvalid")}
            aria-invalid={nameOk ? undefined : true}
            disabled={frozen}
            value={draft ?? nextTableName(tables)}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="xlsx-table-name"
          />
        </XlsxGroupRow>
      </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
