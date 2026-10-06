import type { Editor } from "@tiptap/core";
import type { Command } from "@tiptap/pm/state";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
} from "@tiptap/pm/tables";
import { applyCellFill, applyTableBorderPreset, type DocxTableBorderPreset } from "../table/table-borders";
import { toggleFirstRowHeader, toggleRepeatHeaderRows } from "../table/table-header";
import { insertDocxTable } from "../table/table-insert";
import { docxTableContext, enterFirstTableCell } from "../table/table-selection";
import { readTableFormatState, type DocxTableFormatState } from "../table/table-state";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxTableFormatState } from "../table/table-state";

export interface DocxTableCommands {
  /** Insert a generated rows x cols table at the caret (refused inside a table). */
  insertTable(rows: number, cols: number): boolean;
  addRowAbove(): boolean;
  addRowBelow(): boolean;
  addColumnLeft(): boolean;
  addColumnRight(): boolean;
  deleteRow(): boolean;
  deleteColumn(): boolean;
  deleteTable(): boolean;
  mergeCells(): boolean;
  splitCell(): boolean;
  /** Word's "Header Row" style option (w:tblLook firstRow). */
  toggleHeaderRow(): boolean;
  /** Word's "Repeat Header Rows" (w:trPr w:tblHeader). */
  toggleRepeatHeaderRows(): boolean;
  /** Direct-formatting border preset over the selected cells / whole table. */
  applyTableBorders(preset: DocxTableBorderPreset): boolean;
  /** Cell shading fill (hex without "#"); null clears it. */
  setCellFill(fill: string | null): boolean;
}

export function createTableCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxTableCommands, DocxTableFormatState> {
  const getEditor = (): Editor | null => context.getEditor();

  const editableInTable = (): Editor | null => {
    const editor = getEditor();
    if (!editor || editor.isDestroyed || !editor.isEditable) return null;
    if (!docxTableContext(editor.state)) return null;
    editor.view.focus();
    return editor;
  };

  /** Cell-grid commands (rows/columns/merge/split) need a caret inside a cell;
   * a whole-table node selection is dropped into the first cell first. */
  const runInCell = (command: Command): boolean => {
    const editor = editableInTable();
    if (!editor) return false;
    enterFirstTableCell(editor);
    return command(editor.state, editor.view.dispatch);
  };

  /** Table-level commands (borders, fills, header bits) read the whole-table
   * node selection as the whole grid, so they run without re-seating the caret. */
  const runOnTable = (command: Command): boolean => {
    const editor = editableInTable();
    return editor ? command(editor.state, editor.view.dispatch) : false;
  };

  return {
    commands: {
      insertTable: (rows, cols) => {
        const editor = getEditor();
        return editor ? insertDocxTable(editor, rows, cols) : false;
      },
      addRowAbove: () => runInCell(addRowBefore),
      addRowBelow: () => runInCell(addRowAfter),
      addColumnLeft: () => runInCell(addColumnBefore),
      addColumnRight: () => runInCell(addColumnAfter),
      deleteRow: () => runInCell(deleteRow),
      deleteColumn: () => runInCell(deleteColumn),
      deleteTable: () => runInCell(deleteTable),
      mergeCells: () => runInCell(mergeCells),
      splitCell: () => runInCell(splitCell),
      toggleHeaderRow: () => runOnTable(toggleFirstRowHeader()),
      toggleRepeatHeaderRows: () => runOnTable(toggleRepeatHeaderRows()),
      applyTableBorders: (preset) => runOnTable(applyTableBorderPreset(preset)),
      setCellFill: (fill) => runOnTable(applyCellFill(fill)),
    },
    readState: readTableFormatState,
  };
}
