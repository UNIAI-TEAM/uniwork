"use client";

// Wave B / B4 (UNI-926): Data-tab filter group. The Filter toggle is the
// pinned `smart-toggle-filter` (create the autoFilter over the selection, or
// remove it), Clear filter drops every column's criteria, and the third
// control opens the editor-owned Advanced Filter dialog. All three run through
// the toolbar's one command port; the renderer policy stays the savability
// gate.

import { Filter, ListFilter, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import {
  XLSX_FILTER_CLEAR_COMMAND,
  XLSX_FILTER_TOGGLE_COMMAND,
} from "../filter/filter-commands";

export function XlsxFilterGroup({
  readOnly = false,
  commands,
  onOpenAdvancedFilter,
}: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = readOnly || !commands;
  const run = (id: string) => {
    if (blocked) return;
    // The pinned smart-toggle handler is async; the helper reports a refusal
    // or rejection without unmounting the toolbar.
    fireCommand(commands, id);
  };
  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.filter.toggle")}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-filter-toggle"
        onClick={() => run(XLSX_FILTER_TOGGLE_COMMAND)}
      >
        <Filter aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.filter.clear")}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-filter-clear"
        onClick={() => run(XLSX_FILTER_CLEAR_COMMAND)}
      >
        <ListFilter aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.filter.advanced")}
        aria-haspopup="dialog"
        aria-disabled={blocked || !onOpenAdvancedFilter || undefined}
        data-testid="xlsx-filter-advanced"
        onClick={() => {
          if (blocked || !onOpenAdvancedFilter) return;
          onOpenAdvancedFilter();
        }}
      >
        <SlidersHorizontal aria-hidden />
      </Button>
    </>
  );
}
