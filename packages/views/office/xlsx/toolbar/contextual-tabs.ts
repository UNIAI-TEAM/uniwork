"use client";

// R4 (chrome amendment R): the XLSX contextual tabs. Excel shows Table Design
// + Table Layout while the selection sits inside a table. They render AFTER
// the fixed tabs, accent coloured with a top border, and only while a table is
// active (selecting a table never force-switches tabs).
//
// Every command here reuses a command id the renderer already allowlists and
// journals (the structural insert/delete family, the merge family and
// delete-table), so no new op and no save-path change is introduced. The table
// STYLE write path does not exist in the gateway yet, so that control is
// absent rather than pretending (see tableDesignTab).
import { createElement } from "react";
import {
  Columns3,
  Combine,
  Rows3,
  Table2,
  TableCellsMerge,
  TableCellsSplit,
  Grid3X3,
} from "lucide-react";
import type { RibbonCustomItem, RibbonGroup, RibbonTab } from "../../ribbon";
import { XlsxTableDesignName } from "./table-design-name";
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
          { id: "table-layout-row-below", labelKey: "office.xlsx.structure.insertRowsBelow", onSelect: () => context.commands?.execute("sheet.command.insert-multi-rows-after", { value: 1 }) },
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
          { id: "table-layout-col-right", labelKey: "office.xlsx.structure.insertColsRight", onSelect: () => context.commands?.execute("sheet.command.insert-multi-cols-right", { value: 1 }) },
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
  // Only commands with a real save path are offered. The journal records a
  // table's creation and the cancellation of a session-created table, nothing
  // else: rename, resize, style options and the style gallery have no command
  // the policy allows, so they are absent rather than disabled placeholders.
  const groups: RibbonGroup[] = [];
  if (table !== null) {
    const name: RibbonCustomItem = {
      kind: "custom",
      id: "table-design-name",
      labelKey: "office.xlsx.table.nameLabel",
      width: 136,
      render: () => createElement(XlsxTableDesignName, { name: table.name }),
    };
    groups.push({ id: "table-design-properties", labelKey: "office.xlsx.table.contextual.properties", priority: 10, icon: Table2, items: [name] });
    // A file-native table has no removal path; only a session-created one can
    // be cancelled (its baked cells stay, i.e. Excel's Convert to Range).
    if (table.native !== true) {
      groups.push({
        id: "table-design-tools",
        labelKey: "office.xlsx.table.contextual.tools",
        priority: 11,
        icon: Grid3X3,
        items: [
          {
            kind: "button",
            id: "table-design-convert",
            labelKey: "office.xlsx.table.contextual.convertToRange",
            icon: Grid3X3,
            size: "small",
            disabled,
            onExecute: () => {
              void context.commands?.execute("sheet.command.delete-table", { name: table.name });
            },
          },
        ],
      });
    }
  }
  return {
    id: "table-design",
    labelKey: "office.xlsx.toolbar.tabs.tableDesign",
    contextual: { when, accent: "brand" },
    groups,
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
