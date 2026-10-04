// B8 (UNI-924): the insert dialog — type picker, editable data grid, table
// seeding and the engine-shaped spec it hands to the port.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DocxChartEditing, DocxChartInsertSpec } from "./docx-chart-commands";
import { DocxChartInsert } from "./docx-chart-insert";
import type { DocxChartTableData } from "./docx-chart-model";

function createFakeEditing(table: DocxChartTableData | null = null, canInsert = true) {
  const inserted: DocxChartInsertSpec[] = [];
  const port: DocxChartEditing = {
    canInsert: () => canInsert,
    readSelectedTable: () => table,
    insert: (spec) => {
      inserted.push(spec);
      return true;
    },
  };
  return { port, inserted };
}

const TABLE: DocxChartTableData = {
  categories: ["Q1", "Q2"],
  series: [{ name: "Bắc", values: [1, null] }],
};

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId("docx-chart-insert-button"));
  return screen.findByTestId("docx-chart-insert-confirm");
}

const typeValue = (row: number, column: number, value: string) =>
  fireEvent.change(screen.getByTestId(`docx-chart-value-${row}-${column}`), { target: { value } });

describe("DocxChartInsert", () => {
  it("disables the entry when the document cannot take an insert", () => {
    const { port } = createFakeEditing(null, false);
    render(<DocxChartInsert editing={port} />);
    expect(screen.getByTestId("docx-chart-insert-button")).toBeDisabled();
  });

  it("disables the entry in read-only", () => {
    const { port } = createFakeEditing(null, true);
    render(<DocxChartInsert editing={port} readOnly />);
    expect(screen.getByTestId("docx-chart-insert-button")).toBeDisabled();
  });

  it("blocks the confirm until a value arrives, then inserts the typed draft", async () => {
    const { port, inserted } = createFakeEditing();
    render(<DocxChartInsert editing={port} />);
    const confirm = await openDialog();
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId("docx-chart-error")).toBeInTheDocument();

    typeValue(0, 0, "5");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.chart).toEqual({
      kind: "bar",
      categories: ["", "", ""],
      series: [{ name: "Chuỗi 1", values: [5, null, null] }],
    });
    expect(inserted[0]!.display).toMatchObject({ partPath: "", kind: "bar", widthPx: 560, heightPx: 240 });
    expect(inserted[0]!.label).toBe("Biểu đồ");
  });

  it("carries the picked kind and a title (which reserves the title row)", async () => {
    const { port, inserted } = createFakeEditing();
    render(<DocxChartInsert editing={port} />);
    await openDialog();
    fireEvent.click(screen.getByTestId("docx-chart-kind-pie"));
    fireEvent.change(screen.getByTestId("docx-chart-title-input"), { target: { value: "Tỉ trọng" } });
    typeValue(0, 2, "7");
    fireEvent.click(screen.getByTestId("docx-chart-insert-confirm"));
    expect(inserted[0]!.chart).toMatchObject({ kind: "pie", title: "Tỉ trọng" });
    expect(inserted[0]!.display.heightPx).toBe(262);
  });

  it("seeds the grid from the selected table and keeps gaps", async () => {
    const { port, inserted } = createFakeEditing(TABLE);
    render(<DocxChartInsert editing={port} />);
    const confirm = await openDialog();
    expect(screen.getByTestId("docx-chart-hint")).toHaveTextContent("bảng đã chọn");
    expect(screen.getByTestId("docx-chart-category-0")).toHaveValue("Q1");
    expect(screen.getByTestId("docx-chart-series-name-0")).toHaveValue("Bắc");
    expect(screen.getByTestId("docx-chart-value-0-1")).toHaveValue("");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(inserted[0]!.chart).toEqual({
      kind: "bar",
      categories: ["Q1", "Q2"],
      series: [{ name: "Bắc", values: [1, null] }],
    });
  });

  it("adds categories and series rows and removes one again", async () => {
    const { port } = createFakeEditing();
    render(<DocxChartInsert editing={port} />);
    await openDialog();
    fireEvent.click(screen.getByTestId("docx-chart-add-category"));
    expect(screen.getByTestId("docx-chart-category-3")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("docx-chart-add-series"));
    expect(screen.getByTestId("docx-chart-series-name-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("docx-chart-remove-series-1"));
    expect(screen.queryByTestId("docx-chart-series-name-1")).not.toBeInTheDocument();
  });
});
