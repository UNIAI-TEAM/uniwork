"use client";

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
