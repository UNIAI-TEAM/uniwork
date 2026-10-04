"use client";

import { Table2 } from "lucide-react";
import type { RibbonItem } from "../../../ribbon";
import { TableGridPicker } from "../../table/table-grid-picker";
import { TableTools } from "../../table/table-tools";
import { EMPTY_TABLE_FORMAT_STATE } from "../../table/table-state";
import type { DocxToolbarGroupContext } from "../types";

/**
 * Task A10: the Insert tab's table group — the Word hover grid picker plus the
 * in-table editing tools (add/delete row/column, merge/split, header row,
 * repeating header rows, border presets and cell shading). Commands and state
 * live in commands/table.ts over docx/table/*; this file only wires them.
 */
/** W-G (UNI-924): the Word grid sizes the typed Insert-table menu offers. The
 * hover grid picker stays in the group component; these entries call the same
 * `insertTable(rows, cols)` command for a keyboard/typed path. */
const TABLE_GRID_SIZES: readonly { rows: number; cols: number; labelKey: string }[] = [
  { rows: 2, cols: 2, labelKey: "office.docx.toolbar.insert.tableSize2x2" },
  { rows: 3, cols: 2, labelKey: "office.docx.toolbar.insert.tableSize3x2" },
  { rows: 3, cols: 3, labelKey: "office.docx.toolbar.insert.tableSize3x3" },
  { rows: 4, cols: 3, labelKey: "office.docx.toolbar.insert.tableSize4x3" },
  { rows: 4, cols: 4, labelKey: "office.docx.toolbar.insert.tableSize4x4" },
  { rows: 5, cols: 5, labelKey: "office.docx.toolbar.insert.tableSize5x5" },
];
export function InsertTableGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const blocked = readOnly || saving || !commands || !format;
  const state = format ?? EMPTY_TABLE_FORMAT_STATE;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <TableGridPicker disabled={blocked} inTable={state.inTable} onInsert={(rows, cols) => commands?.insertTable(rows, cols)} />
      <TableTools disabled={blocked} state={state} commands={commands} />
    </div>
  );
}

/**
 * Typed ribbon items (R7): the primary Insert table command is a large dropdown
 * over the same `insertTable(rows, cols)` command the grid picker calls; the
 * in-table editing strip rides one custom item (its popovers/menus do not fit
 * the typed model). No command is dropped - the group component keeps the hover
 * grid picker for the mounted path.
 */
export function insertTableRibbonItems({ format, commands, readOnly, saving }: DocxToolbarGroupContext): readonly RibbonItem[] {
  const blocked = readOnly || saving || !commands || !format;
  const state = format ?? EMPTY_TABLE_FORMAT_STATE;
  return [
    {
      kind: "dropdown",
      id: "insert-table",
      labelKey: "office.docx.table.insert",
      icon: Table2,
      size: "large",
      disabled: blocked,
      menu: TABLE_GRID_SIZES.map((size) => ({
        id: `insert-table-${size.rows}x${size.cols}`,
        labelKey: size.labelKey,
        onSelect: () => commands?.insertTable(size.rows, size.cols),
      })),
    },
    {
      kind: "custom",
      id: "insert-table-tools",
      labelKey: "office.docx.table.rowsGroup",
      render: () => <TableTools disabled={blocked} state={state} commands={commands} />,
    },
  ];
}
