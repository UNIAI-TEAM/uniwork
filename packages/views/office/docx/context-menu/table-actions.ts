import type { Editor } from "@tiptap/core";
import type { Command } from "@tiptap/pm/state";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  isInTable,
  mergeCells,
  splitCell,
} from "@tiptap/pm/tables";
import { toggleFirstRowHeader } from "../table/table-header";

/**
 * Minimal table handler set for the context menu. Task A10 owns the full table
 * UI (grid picker, borders/shading) in `docx/table/**` + `commands/table.ts`;
 * this module reuses the same `@tiptap/pm/tables` commands for the right-click
 * menu and delegates the header-row toggle to A10's caret-safe command.
 */

/** True when the caret sits inside a table, including a whole-table node selection. */
export function isDocxInTable(editor: Editor): boolean {
  const selection = editor.state.selection;
  return (
    isInTable(editor.state) ||
    (selection instanceof NodeSelection && selection.node.type.name === "docTable")
  );
}

/**
 * A whole-table NodeSelection (the move handle) is not "in" the table for the
 * cell commands; drop the caret into its first cell first, as the vendored
 * renderer does.
 */
function enterFirstCell(editor: Editor): void {
  const selection = editor.state.selection;
  if (selection instanceof NodeSelection && selection.node.type.name === "docTable") {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(selection.from + 1))),
    );
  }
}

function runTableCommand(editor: Editor, command: Command): boolean {
  if (!editor.isEditable || !isDocxInTable(editor)) return false;
  editor.view.focus();
  enterFirstCell(editor);
  return command(editor.state, editor.view.dispatch);
}

export function insertRowAbove(editor: Editor): boolean {
  return runTableCommand(editor, addRowBefore);
}

export function insertRowBelow(editor: Editor): boolean {
  return runTableCommand(editor, addRowAfter);
}

export function insertColumnLeft(editor: Editor): boolean {
  return runTableCommand(editor, addColumnBefore);
}

export function insertColumnRight(editor: Editor): boolean {
  return runTableCommand(editor, addColumnAfter);
}

export function deleteTableRow(editor: Editor): boolean {
  return runTableCommand(editor, deleteRow);
}

export function deleteTableColumn(editor: Editor): boolean {
  return runTableCommand(editor, deleteColumn);
}

export function mergeSelectedCells(editor: Editor): boolean {
  return runTableCommand(editor, mergeCells);
}

export function splitSelectedCell(editor: Editor): boolean {
  return runTableCommand(editor, splitCell);
}

/**
 * Word's Header Row toggle: the first row's cells become header cells, or stop
 * being. Delegated to A10's `toggleFirstRowHeader` so the caret keeps its cell
 * across the toggle (a row rewrite would relocate the selection into row 1).
 */
export function toggleHeaderRow(editor: Editor): boolean {
  return runTableCommand(editor, toggleFirstRowHeader());
}
