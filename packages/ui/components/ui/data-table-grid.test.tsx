import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import * as React from "react";
import { DataTable } from "./data-table";

afterEach(cleanup);

type Row = { id: string; a: string; b: string };

const rows: Row[] = [{ id: "1", a: "A1", b: "B1" }];

const columns: ColumnDef<Row>[] = [
  { id: "__select", header: "Select", accessorKey: "id", size: 40 },
  { id: "title", header: "Title", accessorKey: "id", size: 200 },
  { id: "a", header: "Column A", accessorKey: "a", size: 120 },
  { id: "b", header: "Column B", accessorKey: "b", size: 120 },
];

function TestTable(
  props: Partial<Omit<React.ComponentProps<typeof DataTable<Row>>, "table">>,
) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    state: { columnPinning: { left: ["__select", "title"], right: [] } },
  });
  return <DataTable table={table} {...props} />;
}

const cellsOf = (container: HTMLElement, selector: string) =>
  Array.from(container.querySelectorAll<HTMLElement>(selector)).map((cell) => ({
    id: cell.dataset.columnId,
    border: cell.classList.contains("border-r"),
  }));

describe("DataTable grid lines", () => {
  it("draws a vertical rule between every cell by default", () => {
    const { container } = render(<TestTable />);
    for (const selector of ["th", "tbody td"]) {
      expect(cellsOf(container, selector)).toEqual([
        { id: "__select", border: true },
        { id: "title", border: true },
        { id: "a", border: true },
        { id: "b", border: true },
      ]);
    }
  });

  it("horizontal keeps only the frozen block's edge and lightens row rules", () => {
    const { container } = render(<TestTable gridLines="horizontal" rowClassName="h-10" />);
    for (const selector of ["th", "tbody td"]) {
      expect(cellsOf(container, selector)).toEqual([
        { id: "__select", border: false },
        { id: "title", border: true },
        { id: "a", border: false },
        { id: "b", border: false },
      ]);
    }
    // On the body, so group and load-more rows a caller renders share it.
    expect(container.querySelector("tbody")).toHaveClass("[&>tr]:border-border/60");
    expect(container.querySelector("tbody tr")).toHaveClass("h-10");
  });
});
