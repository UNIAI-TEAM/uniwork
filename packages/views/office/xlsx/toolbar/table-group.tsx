"use client";

// B9 (UNI-926): Insert-tab Table group. Create a table over the current
// selection (header row + data rows) through the pinned `sheet.command.add-table`;
// the name is left to the pinned command (Table1, Table2…). A Remove control
// cancels the table named in the input when it was created this session (a
// file-native table has no removal path and stays view-only). Both run through
// the toolbar's one command port; the renderer policy stays the savability gate.

import { Table2, TableProperties } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { useState } from "react";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows, XlsxLargeButton, XlsxLargeLabel } from "./group-layout";
import { selectionSpan } from "./structure-insert";

export function XlsxTableGroup({ readOnly = false, selection, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const span = selectionSpan(selection);
  // Create needs a selection (the range is the table); Remove only needs the
  // table's name, so it must not be coupled to the selection span.
  const blocked = readOnly || !commands || !span;
  const removeBlocked = readOnly || !commands;
  const [removeName, setRemoveName] = useState("");
  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    fireCommand(commands, id, params);
  };
  // Remove is name-driven: it must not inherit `run`'s `!span` gate, or a
  // visible-but-enabled control would silently no-op without a selection.
  const runRemove = () => {
    if (removeBlocked) return;
    const name = removeName.trim();
    if (!name) return;
    fireCommand(commands, "sheet.command.delete-table", { name });
  };
  const range = span === null ? undefined : {
    range: { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn },
  };
  const canRemove = !removeBlocked && removeName.trim().length > 0;
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.table.create")}
        title={t("office.xlsx.table.create")}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-table-create"
        onClick={() => run("sheet.command.add-table", range)}
      >
        <Table2 aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.table.create")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Input
            className="h-6 w-24 px-1 text-caption"
            aria-label={t("office.xlsx.table.namePlaceholder")}
            disabled={removeBlocked}
            value={removeName}
            onChange={(event) => setRemoveName(event.target.value)}
            data-testid="xlsx-table-remove-name"
          />
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            aria-label={t("office.xlsx.table.remove")}
            title={t("office.xlsx.table.remove")}
            aria-disabled={!canRemove || undefined}
            data-testid="xlsx-table-remove"
            onClick={runRemove}
          >
            <TableProperties aria-hidden />
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
