"use client";

import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  BetweenHorizontalStart,
  Columns3,
  PaintBucket,
  Rows3,
  Table2,
  TableCellsMerge,
  TableCellsSplit,
  TableProperties,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import { cn } from "@uniwork/ui/lib/utils";
import type { DocxTableBorderPreset } from "./table-borders";
import type { DocxTableFormatState } from "./table-state";
import type { DocxTableCommands } from "../commands/table";

/** Word theme tint swatches for cell shading (hex without "#"; document data,
 * not theme tokens — the same convention as the character colour picker). */
const TABLE_FILLS: readonly string[] = [
  "D9EAF7",
  "BDD7EE",
  "DDEBF7",
  "E2F0D9",
  "FFF2CC",
  "FCE4D6",
  "E7E6E6",
  "D9D9D9",
];

export interface TableToolsProps {
  /** Read-only / saving / no runtime: every control is disabled. */
  disabled: boolean;
  state: DocxTableFormatState;
  commands?: DocxTableCommands;
}

type RowAction = "above" | "below" | "delete";
type ColumnAction = "left" | "right" | "delete";

function RowsMenu({ disabled, onPick }: { disabled: boolean; onPick(action: RowAction): void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="toolbar" size="icon-sm" disabled={disabled} aria-label={t("office.docx.table.rowsGroup")} data-testid="docx-table-rows" />
        }
      >
        <Rows3 aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onPick("above")} data-testid="docx-table-row-above">
          <ArrowUpToLine aria-hidden />
          {t("office.docx.table.insertRowAbove")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick("below")} data-testid="docx-table-row-below">
          <ArrowDownToLine aria-hidden />
          {t("office.docx.table.insertRowBelow")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick("delete")} data-testid="docx-table-row-delete">
          <Trash2 aria-hidden />
          {t("office.docx.table.deleteRow")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnsMenu({ disabled, onPick }: { disabled: boolean; onPick(action: ColumnAction): void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="toolbar" size="icon-sm" disabled={disabled} aria-label={t("office.docx.table.columnsGroup")} data-testid="docx-table-columns" />
        }
      >
        <Columns3 aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onPick("left")} data-testid="docx-table-column-left">
          <ArrowLeftToLine aria-hidden />
          {t("office.docx.table.insertColumnLeft")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick("right")} data-testid="docx-table-column-right">
          <ArrowRightToLine aria-hidden />
          {t("office.docx.table.insertColumnRight")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick("delete")} data-testid="docx-table-column-delete">
          <Trash2 aria-hidden />
          {t("office.docx.table.deleteColumn")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BordersMenu({ disabled, onPick }: { disabled: boolean; onPick(preset: DocxTableBorderPreset): void }) {
  const { t } = useTranslation();
  const items: readonly { preset: DocxTableBorderPreset; labelKey: string }[] = [
    { preset: "grid", labelKey: "office.docx.table.bordersGrid" },
    { preset: "outline", labelKey: "office.docx.table.bordersOutline" },
    { preset: "none", labelKey: "office.docx.table.bordersNone" },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="toolbar" size="icon-sm" disabled={disabled} aria-label={t("office.docx.table.borders")} data-testid="docx-table-borders" />
        }
      >
        <Table2 aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {items.map((item) => (
          <DropdownMenuItem key={item.preset} onClick={() => onPick(item.preset)} data-testid={`docx-table-borders-${item.preset}`}>
            {t(item.labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CellFillPicker({ disabled, onPick }: { disabled: boolean; onPick(fill: string | null): void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="toolbar" size="icon-sm" disabled={disabled} aria-label={t("office.docx.table.shading")} data-testid="docx-table-shading" />
        }
      >
        <PaintBucket aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 gap-1.5 p-2">
        <div className="grid grid-cols-5 gap-1">
          {TABLE_FILLS.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={t("office.docx.table.shadingSwatch", { value: `#${hex}` })}
              className="size-5 rounded-sm ring-1 ring-border ring-inset hover:scale-105"
              style={{ backgroundColor: `#${hex}` }}
              data-testid={`docx-table-shading-swatch-${hex}`}
              onClick={() => {
                onPick(hex);
                setOpen(false);
              }}
            />
          ))}
        </div>
        <button
          type="button"
          className="rounded-md px-1.5 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          data-testid="docx-table-shading-none"
          onClick={() => {
            onPick(null);
            setOpen(false);
          }}
        >
          {t("office.docx.table.shadingNone")}
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The in-table editing strip of task A10. Every control is disabled when the
 * caret is not in a table, when the document is read-only/saving, or before a
 * document is open; merge/split carry their own availability flags.
 */
export function TableTools({ disabled, state, commands }: TableToolsProps) {
  const { t } = useTranslation();
  const blocked = disabled || !state.inTable || !commands;
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="docx-table-tools">
      <RowsMenu
        disabled={blocked}
        onPick={(action) => {
          if (action === "above") commands?.addRowAbove();
          else if (action === "below") commands?.addRowBelow();
          else commands?.deleteRow();
        }}
      />
      <ColumnsMenu
        disabled={blocked}
        onPick={(action) => {
          if (action === "left") commands?.addColumnLeft();
          else if (action === "right") commands?.addColumnRight();
          else commands?.deleteColumn();
        }}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        disabled={blocked || !state.canMergeCells}
        aria-label={t("office.docx.table.mergeCells")}
        data-testid="docx-table-merge"
        onClick={() => commands?.mergeCells()}
      >
        <TableCellsMerge aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        disabled={blocked || !state.canSplitCell}
        aria-label={t("office.docx.table.splitCell")}
        data-testid="docx-table-split"
        onClick={() => commands?.splitCell()}
      >
        <TableCellsSplit aria-hidden />
      </Button>
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={state.headerRow}
        disabled={blocked}
        aria-label={t("office.docx.table.headerRow")}
        data-testid="docx-table-header-row"
        onPressedChange={() => commands?.toggleHeaderRow()}
      >
        <TableProperties aria-hidden />
      </Toggle>
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={state.repeatHeaderRows}
        disabled={blocked || !state.canRepeatHeaderRows}
        aria-label={t("office.docx.table.repeatHeaderRows")}
        data-testid="docx-table-repeat-header"
        onPressedChange={() => commands?.toggleRepeatHeaderRows()}
      >
        <BetweenHorizontalStart aria-hidden />
      </Toggle>
      <BordersMenu disabled={blocked} onPick={(preset) => commands?.applyTableBorders(preset)} />
      <CellFillPicker disabled={blocked} onPick={(fill) => commands?.setCellFill(fill)} />
      <Button
        type="button"
        variant="destructive"
        size="icon-sm"
        disabled={blocked}
        aria-label={t("office.docx.table.deleteTable")}
        data-testid="docx-table-delete"
        onClick={() => commands?.deleteTable()}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}
