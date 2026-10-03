import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PdfPage } from "../types";
import { PdfPages } from "./pdf-pages";

const pages: readonly PdfPage[] = [
  { pageNumber: 1, rotation: 0 },
  { pageNumber: 2, rotation: 90 },
  { pageNumber: 3, rotation: 0 },
];

interface DragData {
  types: string[];
  setData: ReturnType<typeof vi.fn>;
  getData: ReturnType<typeof vi.fn>;
  effectAllowed: string;
  dropEffect: string;
}

/** Mirrors the browser contract: setData registers the type, getData reads it. */
function dragData(init: { types?: string[]; data?: Record<string, string> } = {}): DragData {
  const types = [...(init.types ?? [])];
  const store: Record<string, string> = { ...init.data };
  return {
    types,
    setData: vi.fn((type: string, value: string) => {
      store[type] = value;
      if (!types.includes(type)) types.push(type);
    }),
    getData: vi.fn((type: string) => store[type] ?? ""),
    effectAllowed: "",
    dropEffect: "",
  };
}

function provider() {
  return { rotatePages: vi.fn(), deletePages: vi.fn(), setPageOrder: vi.fn() };
}

describe("PdfPages", () => {
  it("selects one page and supports additive multi-select", () => {
    const onSelectionChange = vi.fn();
    render(<PdfPages pages={pages} onSelectionChange={onSelectionChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Trang 2" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith([2]);
    fireEvent.click(screen.getByRole("button", { name: "Trang 3" }), { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([2, 3]);
    expect(screen.getByRole("button", { name: "Trang 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Trang 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("selects a shift range from the anchor and deselects an additive toggle", () => {
    const onSelectionChange = vi.fn();
    const { rerender } = render(<PdfPages pages={pages} onSelectionChange={onSelectionChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Trang 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Trang 3" }), { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([1, 2, 3]);

    rerender(<PdfPages pages={pages} selectedPages={[2]} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Trang 2" }), { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("exposes the rows as a list of list items without listbox semantics", () => {
    render(<PdfPages pages={pages} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("names the command group for the commands it contains", () => {
    render(<PdfPages pages={pages} />);
    expect(screen.getByRole("group", { name: "Lệnh chỉnh sửa PDF" })).toBeInTheDocument();
  });

  it("rotates and deletes every selected page through the direct one-based contracts", () => {
    const rotatePages = vi.fn();
    const deletePage = vi.fn();
    render(<PdfPages pages={pages} selectedPages={[1, 3]} rotatePages={rotatePages} deletePage={deletePage} />);

    fireEvent.click(screen.getByRole("button", { name: "Xoay trang" }));
    expect(rotatePages).toHaveBeenCalledWith([1, 3], 90);
    fireEvent.click(screen.getByRole("button", { name: "Xóa trang" }));
    expect(deletePage.mock.calls).toEqual([[3], [1]]);
  });

  it("guards the delete-all case and disables commands without a selection", () => {
    const deletePage = vi.fn();
    const { rerender } = render(<PdfPages pages={pages} deletePage={deletePage} />);
    expect(screen.getByRole("button", { name: "Xoay trang" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Xóa trang" })).toBeDisabled();

    rerender(<PdfPages pages={pages} selectedPages={[1]} deletePage={deletePage} />);
    expect(screen.getByRole("button", { name: "Xóa trang" })).toBeEnabled();

    rerender(<PdfPages pages={pages} selectedPages={[1, 2, 3]} deletePage={deletePage} />);
    expect(screen.getByRole("button", { name: "Xóa trang" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Xóa trang" }));
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("disables commands and dragging when disabled", () => {
    const host = provider();
    render(<PdfPages pages={pages} disabled selectedPages={[1]} provider={host} />);
    expect(screen.getByRole("button", { name: "Xoay trang" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Xóa trang" })).toBeDisabled();
    expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("draggable", "false");
    expect(screen.queryByTestId("pdf-page-grip")).toBeNull();
  });

  it("shows the drag grip only when reorder is available", () => {
    const { rerender } = render(<PdfPages pages={pages} />);
    expect(screen.queryByTestId("pdf-page-grip")).toBeNull();
    expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("draggable", "false");

    rerender(<PdfPages pages={pages} setPageOrder={vi.fn()} />);
    expect(screen.getAllByTestId("pdf-page-grip")).toHaveLength(3);
    expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("draggable", "true");
  });

  it("renders the empty state outside any list role", () => {
    render(<PdfPages pages={[]} />);
    expect(screen.getByText("Adapter chưa báo trang nào.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("emits the new page order when a thumbnail is dropped", () => {
    const setPageOrder = vi.fn();
    render(<PdfPages pages={pages} setPageOrder={setPageOrder} />);
    const data = dragData();
    fireEvent.dragStart(screen.getByTestId("pdf-page-1"), { dataTransfer: data });
    expect(fireEvent.dragOver(screen.getByTestId("pdf-page-3"), { dataTransfer: data })).toBe(false);
    fireEvent.drop(screen.getByTestId("pdf-page-3"), { dataTransfer: data });
    expect(setPageOrder).toHaveBeenCalledWith([2, 3, 1]);
  });

  it("sets drag data so Firefox starts the drag", () => {
    render(<PdfPages pages={pages} setPageOrder={vi.fn()} />);
    const data = dragData();
    fireEvent.dragStart(screen.getByTestId("pdf-page-2"), { dataTransfer: data });
    expect(data.setData).toHaveBeenCalledWith(expect.any(String), "2");
    expect(data.effectAllowed).toBe("move");
  });

  it("never emits an order for a foreign drop and does not accept it", () => {
    const setPageOrder = vi.fn();
    render(<PdfPages pages={pages} setPageOrder={setPageOrder} />);
    const foreign = dragData({ types: ["Files"], data: { Files: "file.pdf" } });
    expect(fireEvent.dragOver(screen.getByTestId("pdf-page-3"), { dataTransfer: foreign })).toBe(true);
    fireEvent.drop(screen.getByTestId("pdf-page-3"), { dataTransfer: foreign });
    fireEvent.drop(screen.getByTestId("pdf-page-3"));
    expect(setPageOrder).not.toHaveBeenCalled();
  });

  it("clears a cancelled drag so no stale order can be emitted", () => {
    const setPageOrder = vi.fn();
    render(<PdfPages pages={pages} setPageOrder={setPageOrder} />);
    const row = screen.getByTestId("pdf-page-1");
    const data = dragData();
    fireEvent.dragStart(row, { dataTransfer: data });
    fireEvent.dragEnd(row);

    fireEvent.drop(screen.getByTestId("pdf-page-3"), { dataTransfer: dragData({ types: [...data.types] }) });
    expect(setPageOrder).not.toHaveBeenCalled();
  });

  it("clears the drag when the pointer leaves the list and still lands on return", () => {
    const setPageOrder = vi.fn();
    render(<PdfPages pages={pages} setPageOrder={setPageOrder} />);
    const list = screen.getByRole("list");
    const data = dragData();
    fireEvent.dragStart(screen.getByTestId("pdf-page-1"), { dataTransfer: data });

    fireEvent(list, new MouseEvent("dragleave", { bubbles: true, relatedTarget: document.body }));
    fireEvent.drop(screen.getByTestId("pdf-page-3"), { dataTransfer: dragData({ types: [...data.types] }) });
    expect(setPageOrder).not.toHaveBeenCalled();

    fireEvent.drop(screen.getByTestId("pdf-page-3"), { dataTransfer: data });
    expect(setPageOrder).toHaveBeenCalledWith([2, 3, 1]);
  });

  it("emits zero-based provider envelopes and ignores direct callbacks when both are set", () => {
    const host = provider();
    const directRotate = vi.fn();
    const directDelete = vi.fn();
    render(<PdfPages pages={pages} selectedPages={[1, 3]} provider={host} rotatePages={directRotate} deletePage={directDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "Xoay trang" }));
    expect(host.rotatePages).toHaveBeenCalledWith({ pages: [0, 2], dir: 90 });
    fireEvent.click(screen.getByRole("button", { name: "Xóa trang" }));
    expect(host.deletePages).toHaveBeenCalledTimes(1);
    expect(host.deletePages).toHaveBeenCalledWith({ pageIndexes: [0, 2] });
    expect(directRotate).not.toHaveBeenCalled();
    expect(directDelete).not.toHaveBeenCalled();
  });

  it("maps a drag to the provider's zero-based page order", () => {
    const host = provider();
    render(<PdfPages pages={pages} provider={host} />);
    const data = dragData();
    fireEvent.dragStart(screen.getByTestId("pdf-page-1"), { dataTransfer: data });
    fireEvent.dragOver(screen.getByTestId("pdf-page-3"), { dataTransfer: data });
    fireEvent.drop(screen.getByTestId("pdf-page-3"), { dataTransfer: data });
    expect(host.setPageOrder).toHaveBeenCalledWith({ order: [1, 2, 0] });
  });
});
