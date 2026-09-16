import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import * as React from "react";
import { DataTable } from "./data-table";

afterEach(cleanup);

type Row = { id: string; a: string; b: string; c: string };

const rows: Row[] = [{ id: "1", a: "A1", b: "B1", c: "C1" }];

// "__select" and "title" stand in for the non-reorderable ids table-view.tsx
// will actually use (row-select, the primary title column); "a"/"b"/"c" are
// the reorderable ones under test.
const columns: ColumnDef<Row>[] = [
  { id: "__select", header: "Select", accessorKey: "id", size: 40 },
  { id: "title", header: "Title", accessorKey: "id", size: 200 },
  { id: "a", header: "Column A", accessorKey: "a", size: 120 },
  { id: "b", header: "Column B", accessorKey: "b", size: 120 },
  { id: "c", header: "Column C", accessorKey: "c", size: 120 },
];

// Left-to-right rects, distinct per column, so dnd-kit's collision detection
// can tell columns apart. jsdom gives every element a zero rect by default —
// with everything at (0,0,0,0) every column would be equidistant and a "move
// right" gesture would have nothing to resolve against.
const COLUMN_LEFT: Record<string, number> = {
  __select: 0,
  title: 40,
  a: 240,
  b: 360,
  c: 480,
};
const COLUMN_WIDTH = 120;

function stubRect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    width,
    height: 32,
    top: 0,
    left,
    right: left + width,
    bottom: 32,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

function stubColumnRects(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ) {
    const columnId = this.getAttribute("data-column-id");
    if (columnId && columnId in COLUMN_LEFT) {
      return stubRect(COLUMN_LEFT[columnId]!, COLUMN_WIDTH);
    }
    return original.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

function TestTable(
  props: Partial<Omit<React.ComponentProps<typeof DataTable<Row>>, "table">>,
) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });
  return <DataTable table={table} {...props} />;
}

describe("DataTable column reorder", () => {
  it("renders no grip when onColumnReorder is absent", () => {
    const { container } = render(
      <TestTable reorderableColumnIds={["a", "b", "c"]} />,
    );
    expect(
      container.querySelectorAll('[data-slot="data-table-reorder-handle"]'),
    ).toHaveLength(0);
  });

  it("renders a grip only for reorderable columns", () => {
    render(
      <TestTable
        reorderableColumnIds={["a", "b", "c"]}
        onColumnReorder={() => {}}
        reorderHandleLabel={(id) => `Reorder ${id} column`}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reorder a column" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reorder title column/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reorder __select column/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the global focus-visible outline on the grip (no outline-none)", () => {
    render(
      <TestTable
        reorderableColumnIds={["a", "b", "c"]}
        onColumnReorder={() => {}}
        reorderHandleLabel={(id) => `Reorder ${id} column`}
      />,
    );

    const grip = screen.getByRole("button", { name: "Reorder a column" });
    expect(grip.className).not.toContain("outline-none");
    expect(grip).toHaveClass("focus-visible:opacity-100");
  });

  it("reorders columns from the keyboard: pick up, move right, drop", async () => {
    const onColumnReorder = vi.fn();
    const restoreRects = stubColumnRects();

    try {
      render(
        <TestTable
          reorderableColumnIds={["a", "b", "c"]}
          onColumnReorder={onColumnReorder}
          reorderHandleLabel={(id) => `Reorder ${id} column`}
        />,
      );

      const grip = screen.getByRole("button", { name: "Reorder a column" });
      grip.focus();
      fireEvent.keyDown(grip, { code: "Space" });
      // dnd-kit's KeyboardSensor registers its follow-up keydown listener
      // (for the move/drop keys) via a zero-delay setTimeout inside the
      // pickup handler, so the next keydown has to land on a later tick —
      // firing it synchronously would be dropped on the floor.
      await new Promise((resolve) => setTimeout(resolve, 0));
      fireEvent.keyDown(grip, { code: "ArrowRight" });
      fireEvent.keyDown(grip, { code: "Space" });
    } finally {
      restoreRects();
    }

    expect(onColumnReorder).toHaveBeenCalledWith("a", "b");
  });
});
