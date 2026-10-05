"use client";

import { ChevronDown, Grid3X3, Rows3, SquareMinus, SquarePlus, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { RibbonItem } from "../../ribbon";
import { fireCommand } from "../fire-command";
import { selectionSpan } from "./structure-insert";
import { XlsxStructureSizeGroup } from "./structure-size";
import type { XlsxToolbarGroupProps } from "./types";

// min-w-22 is the spacing-scale spelling of the 88px floor the Cells menus
// opened with (22 * 0.25rem = 5.5rem), so the rendered width is unchanged.
const MENU_BUTTON_CLASS = "h-6 w-auto min-w-22 justify-start gap-1 px-1.5 text-caption font-normal whitespace-nowrap";

interface CellsMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
}

/** One Excel "Cells" dropdown: icon + label + chevron that opens a popover.
 *  A blocked control stays rendered with `aria-disabled` and never opens. */
function CellsMenu({
  id,
  labelKey,
  icon: Icon,
  blocked,
  entries,
  children,
}: {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  blocked: boolean;
  entries?: readonly CellsMenuEntry[];
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t(labelKey);
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(blocked ? false : next)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            className={MENU_BUTTON_CLASS}
            title={label}
            aria-label={label}
            aria-disabled={blocked || undefined}
            data-testid={`xlsx-${id}-trigger`}
          />
        }
      >
        <Icon aria-hidden />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown aria-hidden className="size-3" />
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={label}
        align="start"
        data-ribbon-portal=""
        data-testid={`xlsx-${id}-menu`}
        className="w-auto max-w-72 flex-col items-stretch gap-1 p-2"
      >
        {entries?.map((entry) => (
          <Button
            key={entry.id}
            type="button"
            variant="toolbar"
            size="sm"
            className="justify-start"
            aria-disabled={blocked || undefined}
            data-testid={`xlsx-${id}-${entry.id}`}
            onClick={() => {
              if (blocked) return;
              entry.onSelect();
              setOpen(false);
            }}
          >
            {entry.label}
          </Button>
        ))}
        {children}
      </PopoverContent>
    </Popover>
  );
}

function InsertMenu(context: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const { readOnly = false, selection, commands } = context;
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || !span;
  const run = (command: string, params?: unknown) => () => fireCommand(commands, command, params);
  const entries: readonly CellsMenuEntry[] = span === null ? [] : [
    { id: "rows-above", label: t("office.xlsx.structure.insertRowsAbove", { count: span.rows }), onSelect: run("sheet.command.insert-row-before", { value: span.rows }) },
    { id: "rows-below", label: t("office.xlsx.structure.insertRowsBelow"), onSelect: run("sheet.command.insert-row-after") },
    { id: "cols-left", label: t("office.xlsx.structure.insertColsLeft", { count: span.columns }), onSelect: run("sheet.command.insert-col-before", { value: span.columns }) },
    { id: "cols-right", label: t("office.xlsx.structure.insertColsRight"), onSelect: run("sheet.command.insert-col-after") },
  ];
  return <CellsMenu id="cells-insert" labelKey="office.xlsx.toolbar.groups.cellsItems.insert" icon={SquarePlus} blocked={blocked} entries={entries} />;
}

function DeleteMenu(context: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const { readOnly = false, selection, commands } = context;
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || !span;
  const removeParams = span === null ? undefined : {
    range: { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn },
  };
  const entries: readonly CellsMenuEntry[] = [
    { id: "rows", label: t("office.xlsx.structure.deleteRows"), onSelect: () => fireCommand(commands, "sheet.command.remove-row", removeParams) },
    { id: "cols", label: t("office.xlsx.structure.deleteCols"), onSelect: () => fireCommand(commands, "sheet.command.remove-col", removeParams) },
  ];
  return <CellsMenu id="cells-delete" labelKey="office.xlsx.toolbar.groups.cellsItems.delete" icon={SquareMinus} blocked={blocked} entries={entries} />;
}

/** Format: row height / column width entry, hide/show, and the sheet list
 *  (the Sheets action moved here from its own Home group). The size controls
 *  are the existing structure-size group, so its inputs keep their commands. */
function FormatMenu(context: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  // Never blocked itself: the Sheets entry works read-only and without a
  // selection, and the size controls inside block themselves.
  return (
    <CellsMenu id="cells-format" labelKey="office.xlsx.toolbar.groups.cellsItems.format" icon={Rows3} blocked={false}>
      <XlsxStructureSizeGroup {...context} />
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        className="justify-start gap-1.5"
        data-testid="xlsx-cells-format-sheets"
        onClick={context.onShowSheets}
      >
        <Grid3X3 aria-hidden />
        {t("office.xlsx.commands.sheets")}
      </Button>
    </CellsMenu>
  );
}

/** Home > Cells as three stacked Excel-style dropdowns: Insert, Delete, Format.
 *  The Insert-tab group is unchanged and keeps the same command ids. */
export function xlsxCellsRibbonItems(context: XlsxToolbarGroupProps): readonly RibbonItem[] {
  const blocked = context.readOnly === true || !context.commands || !selectionSpan(context.selection);
  const item = (id: string, labelKey: string, render: () => ReactNode, rowBreak: boolean, disabled: boolean): RibbonItem => ({
    kind: "custom",
    id,
    labelKey,
    size: "icon",
    collapseAs: "icon",
    rowBreak,
    width: 108,
    disabled,
    render,
  });
  return [
    item("cells-insert", "office.xlsx.toolbar.groups.cellsItems.insert", () => <InsertMenu {...context} />, false, blocked),
    item("cells-delete", "office.xlsx.toolbar.groups.cellsItems.delete", () => <DeleteMenu {...context} />, true, blocked),
    item("cells-format", "office.xlsx.toolbar.groups.cellsItems.format", () => <FormatMenu {...context} />, true, false),
  ];
}
