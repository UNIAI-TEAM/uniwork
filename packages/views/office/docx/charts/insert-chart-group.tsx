"use client";

// B8 (UNI-924): Insert ▸ chart. The dialog owns the type picker and the data
// grid; the command runtime carries the finished spec to the document, so this
// group only adapts the runtime to the dialog's port and mirrors the selected
// table fact into the button hint.
import type { DocxToolbarGroupContext } from "../toolbar/types";
import type { DocxChartEditing } from "./docx-chart-commands";
import { DocxChartInsert } from "./docx-chart-insert";

export function InsertChartGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const editing: DocxChartEditing = {
    canInsert: () => commands?.canInsertDocxChart() ?? false,
    readSelectedTable: () => commands?.readDocxChartTable() ?? null,
    insert: (spec) => commands?.insertDocxChart(spec) ?? false,
  };
  return (
    <DocxChartInsert
      editing={editing}
      readOnly={readOnly || saving}
      hasTable={format?.docxChartTableReady ?? false}
    />
  );
}
