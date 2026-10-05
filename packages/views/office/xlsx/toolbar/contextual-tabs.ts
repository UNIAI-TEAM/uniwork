"use client";

// R4 (chrome amendment R): the XLSX contextual tabs. Excel shows Table Design
// + Table Layout while the selection sits inside a table. They render AFTER
// the fixed tabs, accent coloured with a top border, and only while a table is
// active (selecting a table never force-switches tabs).
//
// Every command here reuses a command id the renderer already allowlists and
// journals (the structural insert/delete family, the merge family and
// delete-table), so no new op and no save-path change is introduced. The table
// STYLE write path does not exist in the gateway yet, so that one control stays
// disabled with its labelled "not available" reason rather than pretending.
import {
  Columns3,
  Combine,
  Rows3,
  Table2,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
} from "lucide-react";
import type { RibbonGroup, RibbonItem, RibbonTab } from "../../ribbon";
import type { XlsxSelection } from "../types";
import type { XlsxToolbarGroupProps, XlsxToolbarTable, XlsxToolbarTableRange } from "./types";

/** Parse an A1 address to 0-based row/column, or null when malformed. */
function parseAddress(address: string): { row: number; column: number } | null {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(address);
  if (!match) return null;
  let column = 0;
  for (const char of match[1]!.toUpperCase()) column = column * 26 + (char.charCodeAt(0) - 64);
  return { row: Number.parseInt(match[2]!, 10) - 1, column: column - 1 };
}

/** The 0-based inclusive rectangle a selection covers, or null. */
export function selectionRect(selection: XlsxSelection | null): XlsxToolbarTableRange | null {
  if (!selection) return null;
  const first = parseAddress(selection.address);
  const last = parseAddress(selection.endAddress ?? selection.address);
  if (!first || !last) return null;
  return {
    startRow: Math.min(first.row, last.row),
    endRow: Math.max(first.row, last.row),
    startColumn: Math.min(first.column, last.column),
    endColumn: Math.max(first.column, last.column),
  };
}

/** The table the selection's rectangle intersects on the selection's sheet. */
export function selectedTable(context: XlsxToolbarGroupProps): XlsxToolbarTable | null {
  const rect = selectionRect(context.selection);
  if (rect === null || context.selection === null) return null;
  const sheet = context.selection.sheet;
  return (context.tables ?? []).find((table) => table.sheet === sheet && intersects(rect, table.range)) ?? null;
}

function intersects(a: XlsxToolbarTableRange, b: XlsxToolbarTableRange): boolean {
  return a.startRow <= b.endRow && a.endRow >= b.startRow && a.startColumn <= b.endColumn && a.endColumn >= b.startColumn;
}

/** True while the selection sits inside a table (R4 "when"). */
export function isSelectionInTable(context: XlsxToolbarGroupProps): boolean {
  return selectedTable(context) !== null;
}

function tableLayoutTab(context: XlsxToolbarGroupProps, when: boolean): RibbonTab {
  const disabled = context.readOnly === true || !context.commands;
  const rect = selectionRect(context.selection);
  const rowsGroup: RibbonGroup = {
    id: "table-layout-rows",
    labelKey: "office.xlsx.table.contextual.rows",
    priority: 10,
    items: [
      {
        kind: "dropdown",
        id: "table-layout-rows-menu",
        labelKey: "office.xlsx.table.contextual.rows",
        icon: Rows3,
        size: "small",
        disabled,
        menu: [
          { id: "table-layout-row-above", labelKey: "office.xlsx.structure.insertRowsAbove", onSelect: () => context.commands?.execute("sheet.command.insert-row-before", { value: 1 }) },
          { id: "table-layout-row-below", labelKey: "office.xlsx.structure.insertRowsBelow", onSelect: () => context.commands?.execute("sheet.command.insert-row-after") },
          { id: "table-layout-row-delete", labelKey: "office.xlsx.structure.deleteRows", onSelect: () => context.commands?.execute("sheet.command.remove-row", rect === null ? undefined : { range: rect }) },
        ],
      },
    ],
  };
  const columnsGroup: RibbonGroup = {
    id: "table-layout-columns",
    labelKey: "office.xlsx.table.contextual.columns",
    priority: 11,
    items: [
      {
        kind: "dropdown",
        id: "table-layout-columns-menu",
        labelKey: "office.xlsx.table.contextual.columns",
        icon: Columns3,
        size: "small",
        disabled,
        menu: [
          { id: "table-layout-col-left", labelKey: "office.xlsx.structure.insertColsLeft", onSelect: () => context.commands?.execute("sheet.command.insert-col-before", { value: 1 }) },
          { id: "table-layout-col-right", labelKey: "office.xlsx.structure.insertColsRight", onSelect: () => context.commands?.execute("sheet.command.insert-col-after") },
          { id: "table-layout-col-delete", labelKey: "office.xlsx.structure.deleteCols", onSelect: () => context.commands?.execute("sheet.command.remove-col", rect === null ? undefined : { range: rect }) },
        ],
      },
    ],
  };
  const cellsGroup: RibbonGroup = {
    id: "table-layout-cells",
    labelKey: "office.xlsx.table.contextual.cells",
    priority: 12,
    items: [
      { kind: "button", id: "table-layout-merge", labelKey: "office.xlsx.structure.mergeCells", icon: TableCellsMerge, size: "small", disabled, onExecute: () => context.commands?.execute("sheet.command.add-worksheet-merge-all", { selections: rect === null ? [] : [rect] }) },
      { kind: "button", id: "table-layout-merge-across", labelKey: "office.xlsx.structure.mergeAcross", icon: Combine, size: "small", disabled, onExecute: () => context.commands?.execute("sheet.command.add-worksheet-merge-horizontal", { selections: rect === null ? [] : [rect] }) },
      { kind: "button", id: "table-layout-unmerge", labelKey: "office.xlsx.structure.unmergeCells", icon: TableCellsSplit, size: "small", disabled, onExecute: () => context.commands?.execute("sheet.command.remove-worksheet-merge", { ranges: rect === null ? [] : [rect] }) },
    ],
  };
  return {
    id: "table-layout",
    labelKey: "office.xlsx.toolbar.tabs.tableLayout",
    contextual: { when, accent: "brand" },
    groups: [rowsGroup, columnsGroup, cellsGroup],
  };
}

function tableDesignTab(context: XlsxToolbarGroupProps, when: boolean): RibbonTab {
  const disabled = context.readOnly === true || !context.commands;
  const table = selectedTable(context);
  const items: readonly RibbonItem[] = [
    {
      // The gateway has no post-creation table-style write path yet, so the
      // control announces itself unavailable instead of pretending to work.
      kind: "dropdown",
      id: "table-design-style-menu",
      labelKey: "office.xlsx.table.contextual.style",
      icon: Table2,
      size: "small",
      disabled: true,
      tooltipKey: "office.xlsx.capabilityPending",
      menu: [{ id: "table-design-style-medium", labelKey: "office.xlsx.table.contextual.styleMedium", disabled: true, onSelect: () => {} }],
    },
    {
      kind: "button",
      id: "table-design-remove",
      labelKey: "office.xlsx.table.remove",
      icon: Trash2,
      size: "small",
      disabled: disabled || table === null,
      onExecute: () => {
        if (table) void context.commands?.execute("sheet.command.delete-table", { name: table.name });
      },
    },
  ];
  return {
    id: "table-design",
    labelKey: "office.xlsx.toolbar.tabs.tableDesign",
    contextual: { when, accent: "brand" },
    groups: [{ id: "table-design", labelKey: "office.xlsx.table.contextual.style", priority: 10, items }],
  };
}

/**
 * The XLSX contextual tabs for one toolbar context. Both carry `when: false`
 * unless the selection sits inside a table, so OfficeRibbon simply does not
 * render them and the fixed tabs never move.
 */
export function xlsxContextualTabs(context: XlsxToolbarGroupProps): readonly RibbonTab[] {
  const when = isSelectionInTable(context);
  return [tableDesignTab(context, when), tableLayoutTab(context, when)];
}
