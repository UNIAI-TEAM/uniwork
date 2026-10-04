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
import { selectionSpan } from "./structure-insert";

export function XlsxTableGroup({ readOnly = false, selection, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || !span;
  const [removeName, setRemoveName] = useState("");
  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    commands?.execute(id, params);
  };
  const range = span === null ? undefined : {
    range: { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn },
  };
  const canRemove = !blocked && removeName.trim().length > 0;
  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.table.create")}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-table-create"
        onClick={() => run("sheet.command.add-table", range)}
      >
        <Table2 aria-hidden />
      </Button>
      <Input
        className="h-7 w-24 px-1 text-caption"
        aria-label={t("office.xlsx.table.namePlaceholder")}
        disabled={blocked}
        value={removeName}
        onChange={(event) => setRemoveName(event.target.value)}
        data-testid="xlsx-table-remove-name"
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.table.remove")}
        aria-disabled={!canRemove || undefined}
        data-testid="xlsx-table-remove"
        onClick={() => { if (canRemove) run("sheet.command.delete-table", { name: removeName.trim() }); }}
      >
        <TableProperties aria-hidden />
      </Button>
    </>
  );
}
