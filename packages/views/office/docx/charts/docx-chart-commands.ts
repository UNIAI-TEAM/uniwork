// B8 (UNI-924): TipTap glue for the DOCX chart layer — the only place that
// touches the live editor. The node shape is the vendored docProtected chart
// node: chartDisplay renders the plot immediately, genChart is the snapshot
// pmDocToSavePlan emits as kind:"chart" at save time. Pure logic lives in
// ./docx-chart-model so tests can cover it without an editor.
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { DocxNewChart } from "@uniwork/office-engine/docx";
import {
  chartDataFromTable,
  type DocxChartDisplay,
  type DocxChartTableData,
  type DocxChartTableModel,
} from "./docx-chart-model";

export interface DocxChartInsertSpec {
  chart: DocxNewChart;
  /** Display model for the node view (chartDisplayFromSpec). */
  display: DocxChartDisplay;
  label?: string;
}

/** The narrow port the chart UI consumes; view tests inject a fake. */
export interface DocxChartEditing {
  canInsert(): boolean;
  /** The current selection is a table this flow can read as chart data, or
   * null for any other selection/empty table. */
  readSelectedTable(): DocxChartTableData | null;
  /** Insert the chart at the current selection. False when not editable. */
  insert(spec: DocxChartInsertSpec): boolean;
}

/** Selected docProtected node attrs, or null for any other selection. */
function protectedAttrsOf(editor: Editor): Record<string, unknown> | null {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection)) return null;
  if (selection.node.type.name !== "docProtected") return null;
  return selection.node.attrs as Record<string, unknown>;
}

export function createDocxChartEditing(getEditor: () => Editor | null): DocxChartEditing {
  const live = (): Editor | null => {
    const editor = getEditor();
    return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
  };
  const selectedTable = (): DocxChartTableData | null => {
    const editor = live();
    if (!editor) return null;
    const attrs = protectedAttrsOf(editor);
    if (!attrs || attrs.blockType !== "table") return null;
    return chartDataFromTable(attrs.table as DocxChartTableModel | null);
  };
  return {
    canInsert: () => live() !== null,
    readSelectedTable: selectedTable,
    insert(spec) {
      const editor = live();
      if (!editor) return false;
      const node = {
        type: "docProtected",
        attrs: {
          docxIndex: null,
          blockType: "chart",
          label: spec.label ?? "Chart",
          chartDisplay: spec.display,
          genChart: spec.chart,
        },
      };
      // A selected node (an existing chart) must not be replaced by the new
      // one: land the insert right after it; a text selection inserts at the
      // caret like any other content (same rule as the image layer).
      const selection = editor.state.selection;
      if (selection instanceof NodeSelection) {
        editor.chain().focus().insertContentAt(selection.to, node).run();
      } else {
        editor.chain().focus().insertContent(node).run();
      }
      // Word leaves a text caret after the chart; an empty document must not
      // end up with the chart as its only node (a keystroke would replace it).
      const { doc, selection: after, schema } = editor.state;
      const $after = doc.resolve(Math.min(after.to, doc.content.size));
      if (!$after.parent.isTextblock) {
        const chain = editor.chain();
        if ($after.nodeAfter?.isTextblock !== true && schema.nodes.docParagraph) {
          chain.insertContentAt($after.pos, { type: "docParagraph" });
        }
        chain.setTextSelection($after.pos + 1).run();
      }
      return true;
    },
  };
}
