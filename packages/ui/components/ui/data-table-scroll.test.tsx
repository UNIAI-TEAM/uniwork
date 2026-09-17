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

type Row = { id: string };
const columns: ColumnDef<Row>[] = [{ id: "id", header: "Id", accessorKey: "id" }];

function TestTable({ scrollResetKey }: { scrollResetKey?: string }) {
  const table = useReactTable({
    data: [{ id: "1" }],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return <DataTable table={table} scrollResetKey={scrollResetKey} />;
}

function scrolledContainer(container: HTMLElement) {
  const scroll = container.querySelector<HTMLElement>('[data-slot="data-table-scroll"]')!;
  // jsdom keeps no scroll position; give the element a writable one.
  Object.defineProperty(scroll, "scrollTop", { value: 300, writable: true });
  return scroll;
}

describe("DataTable scrollResetKey", () => {
  it("scrolls back to the top when the key changes", () => {
    const { container, rerender } = render(<TestTable scrollResetKey="a" />);
    const scroll = scrolledContainer(container);
    rerender(<TestTable scrollResetKey="b" />);
    expect(scroll.scrollTop).toBe(0);
  });

  it("keeps the position while the key is unchanged, or when there is none", () => {
    const { container, rerender } = render(<TestTable scrollResetKey="a" />);
    const scroll = scrolledContainer(container);
    rerender(<TestTable scrollResetKey="a" />);
    expect(scroll.scrollTop).toBe(300);

    cleanup();
    const plain = render(<TestTable />);
    const plainScroll = scrolledContainer(plain.container);
    plain.rerender(<TestTable />);
    expect(plainScroll.scrollTop).toBe(300);
  });
});
