import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { TableEdit } from "@uniwork/office-engine/pptx";
import { installTablesPanelI18n } from "./install-tables-i18n";
import { PptxTablesPanel, type PptxTablesPanelProps } from "./pptx-tables-panel";

initI18n();
installTablesPanelI18n();
beforeEach(async () => {
  await setLocale("en");
});

function renderPanel(overrides: Partial<PptxTablesPanelProps> = {}) {
  const onApplyEdit = vi.fn(async (_edit: TableEdit) => undefined);
  const onError = vi.fn();
  const element = (extra: Partial<PptxTablesPanelProps> = {}) => (
    <PptxTablesPanel
      onApplyEdit={onApplyEdit}
      onError={onError}
      slideCount={3}
      slideIndex={1}
      tableElementId="tbl1"
      tableSize={{ rows: 3, cols: 3 }}
      cell={{ row: 0, col: 1 }}
      activeStyleName="zebraBlue"
      cellAnchor="top"
      {...overrides}
      {...extra}
    />
  );
  const view = render(element());
  return { view, rerender: (extra: Partial<PptxTablesPanelProps> = {}) => view.rerender(element(extra)), onApplyEdit, onError };
}

const panel = () => document.querySelector("[data-pptx-tables-panel]") as HTMLElement;

describe("PptxTablesPanel", () => {
  it("mounts the five sections in one labelled panel", () => {
    renderPanel();
    expect(panel()).toHaveAttribute("data-state", "ready");
    expect(screen.getByRole("region", { name: "Tables" })).toBeInTheDocument();
    expect(screen.getByText("Insert table")).toBeInTheDocument();
    expect(screen.getByText("Cell text")).toBeInTheDocument();
    expect(screen.getByText("Rows and columns")).toBeInTheDocument();
    expect(screen.getByText("Merge")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Table style gallery" })).toBeInTheDocument();
    expect(screen.getByTestId("pptx-tables-target")).toHaveTextContent("Table 3 x 3");
  });

  it("inserts a table through the engine edit channel with the default box", async () => {
    const { onApplyEdit } = renderPanel({ tableElementId: null, cell: null });
    fireEvent.change(screen.getByLabelText("Rows"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "4" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Insert table" })[0]!);
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1));
    expect(onApplyEdit.mock.calls[0]![0]).toMatchObject({
      op: "add_table",
      slideIndex: 1,
      rows: 2,
      cols: 4,
      xPx: 100,
      yPx: 100,
      wPx: 480,
      hPx: 200,
    });
  });

  it("applies cell text from the field", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply text" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_table_cell",
        slideIndex: 1,
        elementId: "tbl1",
        row: 0,
        col: 1,
        paragraphs: [{ runs: [{ text: "hello" }] }],
      }),
    );
  });

  it("applies a cell anchor", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Bottom" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_table_cell_anchor",
        slideIndex: 1,
        elementId: "tbl1",
        row: 0,
        col: 1,
        anchor: "bottom",
      }),
    );
  });

  it("applies a row structure edit at the selected row", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Insert row" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "table_structure",
        slideIndex: 1,
        elementId: "tbl1",
        kind: "insert-row",
        index: 0,
        before: true,
      }),
    );
  });

  it("applies a row height in px", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByLabelText("Row height (px)"), { target: { value: "55" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Apply size" })[0]!);
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_table_row_height",
        slideIndex: 1,
        elementId: "tbl1",
        row: 0,
        hPx: 55,
      }),
    );
  });

  it("applies a merge", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Merge right" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "table_merge",
        slideIndex: 1,
        elementId: "tbl1",
        kind: "merge-right",
        row: 0,
        col: 1,
      }),
    );
  });

  it("applies a style preset and marks the active one", async () => {
    const { onApplyEdit } = renderPanel();
    expect(document.querySelector('[data-pptx-tables-style-preset="zebraBlue"]')).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Apply style Banded gray" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_table_style",
        slideIndex: 1,
        elementId: "tbl1",
        styleName: "zebraGray",
      }),
    );
  });

  it("reports a refused edit and keeps the document claim honest", async () => {
    const onApplyEdit = vi.fn(async () => {
      throw new Error("bad_table_style");
    });
    const onError = vi.fn();
    renderPanel({ onApplyEdit, onError });
    fireEvent.click(screen.getByRole("radio", { name: "Apply style Banded gray" }));
    const alert = await screen.findByTestId("pptx-tables-error");
    expect(alert).toHaveTextContent("The table change could not be applied");
    expect(alert).toHaveTextContent("bad_table_style");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(panel()).toHaveAttribute("data-state", "ready");
  });

  it("shows the busy state while an edit is in flight and refuses a duplicate", async () => {
    let resolve!: () => void;
    const onApplyEdit = vi.fn(
      (_edit: TableEdit) =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    renderPanel({ onApplyEdit });
    fireEvent.click(screen.getByRole("button", { name: "Merge right" }));
    expect(screen.getByTestId("pptx-tables-busy")).toHaveTextContent("Applying...");
    fireEvent.click(screen.getByRole("button", { name: "Split cell" }));
    expect(onApplyEdit).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "ready"));
  });

  it("renders the loading state as a busy status region", () => {
    renderPanel({ loading: true });
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status", { name: "Loading table options..." })).toHaveAttribute("aria-busy", "true");
  });

  it("renders the empty state for a deck with no slides", () => {
    renderPanel({ slideCount: 0, slideIndex: null });
    expect(panel()).toHaveAttribute("data-state", "empty");
    expect(panel()).toHaveTextContent("Select a table to edit it");
  });

  it("disables every control and says so when no edit channel is bound", () => {
    renderPanel({ onApplyEdit: undefined });
    expect(screen.getByTestId("pptx-tables-unbound")).toHaveTextContent("Table changes are not connected to this editor yet.");
    expect(screen.getByRole("radio", { name: "Apply style Banded gray" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merge right" })).toBeDisabled();
  });

  it("disables every control in read-only mode and explains why", () => {
    const { onApplyEdit } = renderPanel({ disabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Merge right" }));
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("pptx-tables-unbound")).toHaveTextContent("This presentation is read-only.");
  });

  it("explains a missing table selection", () => {
    renderPanel({ tableElementId: null, cell: null });
    expect(screen.getByTestId("pptx-tables-target-refusal")).toHaveTextContent("Select a table on the slide to edit it.");
    expect(screen.getByRole("button", { name: "Merge right" })).toBeDisabled();
  });

  it("explains a missing cell selection", () => {
    renderPanel({ cell: null });
    expect(screen.getByTestId("pptx-tables-target-refusal")).toHaveTextContent("Select a cell in the table.");
    expect(screen.getByRole("button", { name: "Merge right" })).toBeDisabled();
    // Insert stays usable: it does not need a table or a cell.
    expect(screen.getAllByRole("button", { name: "Insert table" })[0]!).toBeEnabled();
  });
});