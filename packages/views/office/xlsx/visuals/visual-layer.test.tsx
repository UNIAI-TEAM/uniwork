import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { XlsxVisualLayer, type XlsxVisualLayerItem, type XlsxVisualLayerProps } from "./visual-layer";
import type { XlsxEditorVisual, XlsxVisualBox } from "./visual-model";

const ANCHOR = { fromRow: 0, fromColumn: 0, fromRowOffset: 0, fromColumnOffset: 0, toRow: 2, toColumn: 2, toRowOffset: 0, toColumnOffset: 0 };
const BOX: XlsxVisualBox = { x: 100, y: 100, width: 120, height: 80 };
const SHAPE_ID = "xlsx-visual-item-shape";

function visual(kind: "chart" | "shape" | "picture", overrides: Partial<XlsxEditorVisual> = {}): XlsxEditorVisual {
  const body =
    kind === "chart"
      ? { chart: { chartType: "column" as const, title: "Sales", series: [{ name: "A", categories: ["x", "y"], values: [1, 2] }] } }
      : kind === "shape"
        ? { shape: { shapeType: "rect" as const } }
        : { image: { mediaType: "image/png" as const, base64: "AAAA" } };
  return { id: `v-${kind}`, sheetId: "s1", anchor: ANCHOR, generation: 1, saved: false, ...body, ...overrides };
}

function setup(items: readonly XlsxVisualLayerItem[], overrides: Partial<XlsxVisualLayerProps> = {}) {
  const props = { onSelect: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(), ...overrides };
  const view = render(<XlsxVisualLayer items={items} selectedId={null} readOnly={false} {...props} />);
  return { props, ...view };
}

beforeEach(async () => {
  await setLocale("en");
});

describe("XlsxVisualLayer", () => {
  it("renders one named button per visual", () => {
    setup([
      { visual: visual("chart"), box: BOX },
      { visual: visual("shape"), box: BOX },
      { visual: visual("picture"), box: BOX },
      { visual: visual("picture", { id: "hidden" }), box: null },
    ]);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByTestId("xlsx-visual-item-chart")).toHaveAccessibleName("Column chart Sales");
    expect(screen.getByTestId(SHAPE_ID)).toHaveAccessibleName("Shape: Rectangle");
    expect(screen.getByTestId("xlsx-visual-item-picture")).toHaveAccessibleName("Picture");
    expect(within(screen.getByTestId("xlsx-visual-item-chart")).getByRole("img")).toBeInTheDocument();
  });

  it("selects an item on focus", () => {
    const { props } = setup([{ visual: visual("shape"), box: BOX }]);
    act(() => screen.getByTestId(SHAPE_ID).focus());
    expect(props.onSelect).toHaveBeenCalledWith("v-shape");
  });

  it("shows four handles and a delete button on the selected item", () => {
    const item = { visual: visual("shape"), box: BOX };
    const { props } = setup([item], { selectedId: "v-shape" });
    for (const handle of ["nw", "ne", "sw", "se"]) expect(screen.getByTestId(`xlsx-visual-handle-${handle}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Shape: Rectangle" }));
    expect(props.onRemove).toHaveBeenCalledWith(item.visual);
  });

  it("renders the delete button beside the item, never inside it, and keeps it on screen at the top edge", () => {
    setup([{ visual: visual("shape"), box: BOX }], { selectedId: "v-shape" });
    const item = screen.getByTestId(SHAPE_ID);
    const remove = screen.getByTestId("xlsx-visual-delete");
    // No interactive control nested in the role=button item.
    expect(item).not.toContainElement(remove);
    expect(remove).toHaveStyle({ top: "64px" });
    setup([{ visual: visual("shape", { id: "top" }), box: { ...BOX, y: 10 } }], { selectedId: "top" });
    expect(screen.getAllByTestId("xlsx-visual-delete").at(-1)).toHaveStyle({ top: "14px" });
  });

  it("handles keyboard remove, nudge, resize and escape", () => {
    const item = { visual: visual("shape"), box: BOX };
    const { props } = setup([item], { selectedId: "v-shape" });
    const el = screen.getByTestId(SHAPE_ID);
    fireEvent.keyDown(el, { key: "Delete" });
    expect(props.onRemove).toHaveBeenCalledWith(item.visual);
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(props.onMove).toHaveBeenLastCalledWith(item.visual, { ...BOX, x: BOX.x + 8 });
    fireEvent.keyDown(el, { key: "ArrowDown", shiftKey: true });
    expect(props.onMove).toHaveBeenLastCalledWith(item.visual, { ...BOX, height: BOX.height + 8 });
    fireEvent.keyDown(el, { key: "Escape" });
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
  });

  it.each([
    ["saved", { saved: true }, false],
    ["read-only", {}, true],
  ])("locks a %s visual", (_name, overrides, readOnly) => {
    const item = { visual: visual("shape", overrides), box: BOX };
    const { props } = setup([item], { selectedId: "v-shape", readOnly });
    const el = screen.getByTestId(SHAPE_ID);
    expect(screen.queryByTestId("xlsx-visual-handle-se")).toBeNull();
    expect(screen.queryByTestId("xlsx-visual-delete")).toBeNull();
    fireEvent.keyDown(el, { key: "Delete" });
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
    const help = document.getElementById(el.getAttribute("aria-describedby")!);
    expect(help).toHaveTextContent("Saved to the file. Saved drawings cannot be edited yet.");
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 130, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 130, clientY: 110, pointerId: 1 });
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("moves an item by the pointer drag distance", () => {
    const item = { visual: visual("shape"), box: BOX };
    const { props } = setup([item]);
    const el = screen.getByTestId(SHAPE_ID);
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 130, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 130, clientY: 110, pointerId: 1 });
    expect(props.onSelect).toHaveBeenCalledWith("v-shape");
    expect(props.onMove).toHaveBeenCalledTimes(1);
    expect(props.onMove).toHaveBeenCalledWith(item.visual, { ...BOX, x: 130, y: 110 });
  });

  it("does not report a move when the pointer never moved", () => {
    const { props } = setup([{ visual: visual("shape"), box: BOX }]);
    const el = screen.getByTestId(SHAPE_ID);
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("grows the box when the south-east handle is dragged", () => {
    const item = { visual: visual("shape"), box: BOX };
    const { props } = setup([item], { selectedId: "v-shape" });
    const handle = screen.getByTestId("xlsx-visual-handle-se");
    fireEvent.pointerDown(handle, { clientX: 220, clientY: 180, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 240, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 240, clientY: 200, pointerId: 1 });
    expect(props.onMove).toHaveBeenCalledTimes(1);
    expect(props.onMove).toHaveBeenCalledWith(item.visual, { x: 100, y: 100, width: 140, height: 100 });
  });

  it("clears the selection on a press outside the layer", () => {
    const { props } = setup([{ visual: visual("shape"), box: BOX }], { selectedId: "v-shape" });
    fireEvent.pointerDown(document.body);
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("keeps the selection on a press inside the layer", () => {
    const { props } = setup([{ visual: visual("shape"), box: BOX }], { selectedId: "v-shape" });
    fireEvent.pointerDown(screen.getByTestId("xlsx-visual-layer"));
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("forwards a wheel on an item to the grid canvas with the same deltas", () => {
    const surface = document.createElement("div");
    const small = document.createElement("canvas");
    const grid = document.createElement("canvas");
    small.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
    grid.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    document.body.append(surface);
    render(<XlsxVisualLayer items={[{ visual: visual("shape"), box: BOX }]} selectedId={null} readOnly={false} onSelect={vi.fn()} onMove={vi.fn()} onRemove={vi.fn()} />, { container: surface });
    surface.append(small, grid);
    const seen: WheelEvent[] = [];
    grid.addEventListener("wheel", (e) => seen.push(e));
    small.addEventListener("wheel", () => seen.push(new WheelEvent("wrong")));
    fireEvent.wheel(screen.getByTestId(SHAPE_ID), { deltaX: 3, deltaY: 40, deltaMode: 1, clientX: 120, clientY: 130, ctrlKey: true, shiftKey: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ deltaX: 3, deltaY: 40, deltaMode: 1, clientX: 120, clientY: 130, ctrlKey: true, shiftKey: true });
    surface.remove();
  });

  it("Escape calls onReturnFocus when provided", () => {
    const onReturnFocus = vi.fn();
    setup([{ visual: visual("shape"), box: BOX }], { onReturnFocus });
    fireEvent.keyDown(screen.getByTestId(SHAPE_ID), { key: "Escape" });
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
  });

  it("Escape without onReturnFocus focuses the grid focus target, then the surface", () => {
    const surface = document.createElement("div");
    surface.tabIndex = -1;
    const editor = document.createElement("textarea");
    document.body.append(surface);
    const { unmount } = render(<XlsxVisualLayer items={[{ visual: visual("shape"), box: BOX }]} selectedId={null} readOnly={false} onSelect={vi.fn()} onMove={vi.fn()} onRemove={vi.fn()} />, { container: surface });
    surface.append(editor);
    fireEvent.keyDown(screen.getByTestId(SHAPE_ID), { key: "Escape" });
    expect(document.activeElement).toBe(editor);
    editor.remove();
    fireEvent.keyDown(screen.getByTestId(SHAPE_ID), { key: "Escape" });
    expect(document.activeElement).toBe(surface);
    unmount();
    surface.remove();
  });

  it("names a chart with the lowercase inline type in Vietnamese", async () => {
    await setLocale("vi");
    setup([{ visual: visual("chart"), box: BOX }]);
    expect(screen.getByTestId("xlsx-visual-item-chart")).toHaveAccessibleName("Biểu đồ cột Sales");
  });
});
