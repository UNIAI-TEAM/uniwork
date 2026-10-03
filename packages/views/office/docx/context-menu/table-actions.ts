import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Command, EditorState, Transaction } from "@tiptap/pm/state";
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
  selectedRect,
  splitCell,
} from "@tiptap/pm/tables";

/**
 * Minimal table handler set for the context menu. Task A10 owns the full table
 * UI (grid picker, borders/shading) in `docx/table/**` + `commands/table.ts`;
 * that module was still a placeholder when this task committed, so the menu
 * carries its own handlers over the same `@tiptap/pm/tables` commands and notes
 * the overlap in the worker report.
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

/** Word's Header Row toggle: the cells of the row at the selection become header cells, or stop being. */
export function toggleHeaderRow(editor: Editor): boolean {
  return runTableCommand(editor, toggleHeaderRowCommand);
}

export function toggleHeaderRowCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const headerType = state.schema.nodes.docTableHeader;
  const cellType = state.schema.nodes.docTableCell;
  if (!headerType || !cellType) return false;
  const rect = selectedRect(state);
  const row = rect.table.child(rect.top);
  const firstCell = row.firstChild;
  if (!firstCell) return false;
  const wantHeader = firstCell.type !== headerType;
  const cells: PmNode[] = [];
  let changed = false;
  row.forEach((cell) => {
    const target = wantHeader ? headerType : cellType;
    if (cell.type === target) {
      cells.push(cell);
      return;
    }
    changed = true;
    cells.push(target.create(cell.attrs, cell.content, cell.marks));
  });
  if (!changed) return false;
  let rowPos = rect.tableStart;
  for (let index = 0; index < rect.top; index += 1) rowPos += rect.table.child(index).nodeSize;
  dispatch?.(state.tr.replaceWith(rowPos, rowPos + row.nodeSize, row.type.create(row.attrs, cells, row.marks)));
  return true;
}
