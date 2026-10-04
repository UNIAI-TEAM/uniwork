// B8 (UNI-924): the chart command area. The TipTap glue in
// ../charts/docx-chart-commands owns the document; this file only publishes it
// on the shared command runtime so the toolbar group reaches the insert flow
// and its state shows whether a table is ready to seed the data grid.
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";
import { createDocxChartEditing, type DocxChartInsertSpec } from "../charts/docx-chart-commands";
import type { DocxChartTableData } from "../charts/docx-chart-model";

export interface DocxChartFormatState {
  /** The current selection is a table the insert dialog can seed from. */
  docxChartTableReady: boolean;
}

export interface DocxChartCommands {
  /** A document is open and editable: an insert would land. */
  canInsertDocxChart(): boolean;
  /** Chart data read from the selected table (first row = series names, first
   * column = categories); null when the selection is not a usable table. */
  readDocxChartTable(): DocxChartTableData | null;
  /** Insert the chart at the current selection; false when not editable. */
  insertDocxChart(spec: DocxChartInsertSpec): boolean;
}

export function createChartCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxChartCommands, DocxChartFormatState> {
  const editing = createDocxChartEditing(() => context.getEditor());
  return {
    commands: {
      canInsertDocxChart: () => editing.canInsert(),
      readDocxChartTable: () => editing.readSelectedTable(),
      insertDocxChart: (spec) => editing.insert(spec),
    },
    readState: () => ({ docxChartTableReady: editing.readSelectedTable() !== null }),
  };
}
