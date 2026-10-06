// B8 (UNI-924): the Insert ▸ chart toolbar entry — disabled without a command
// runtime, table-aware hint, and the runtime call the dialog ends in.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../commands";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { InsertChartGroup } from "./insert-chart-group";
import { createDocxDocumentScope } from "../editor-store";

function runtime(overrides: Partial<DocxCommandRuntime> = {}): DocxCommandRuntime {
  return {
    canInsertDocxChart: vi.fn(() => true),
    readDocxChartTable: vi.fn(() => null),
    insertDocxChart: vi.fn(() => true),
    ...overrides,
  } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; readOnly?: boolean; tableReady?: boolean } = {}) {
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    docScope: createDocxDocumentScope(),
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: { docxChartTableReady: options.tableReady ?? false } as unknown as DocxToolbarGroupContext["format"],
    commands,
    selection: null,
    readOnly: options.readOnly ?? false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  render(<InsertChartGroup {...props} />);
  return { commands };
}

describe("InsertChartGroup", () => {
  it("disables the entry without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-chart-insert-button")).toBeDisabled();
  });

  it("hints a ready table and inserts through the runtime", async () => {
    const readDocxChartTable = vi.fn(() => ({
      categories: ["Q1"],
      series: [{ name: "Bắc", values: [4] }],
    }));
    const insertDocxChart = vi.fn(() => true);
    const { commands } = renderGroup({ commands: runtime({ readDocxChartTable, insertDocxChart }), tableReady: true });
    expect(screen.getByTestId("docx-chart-insert-button")).toHaveAttribute("title", "Chèn biểu đồ từ bảng đã chọn");

    fireEvent.click(screen.getByTestId("docx-chart-insert-button"));
    const confirm = await screen.findByTestId("docx-chart-insert-confirm");
    expect(screen.getByTestId("docx-chart-category-0")).toHaveValue("Q1");
    fireEvent.click(confirm);
    expect(commands?.insertDocxChart).toHaveBeenCalledWith(
      expect.objectContaining({ chart: { kind: "bar", categories: ["Q1"], series: [{ name: "Bắc", values: [4] }] } }),
    );
  });

  it("stays disabled while the document is read-only", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByTestId("docx-chart-insert-button")).toBeDisabled();
  });
});
