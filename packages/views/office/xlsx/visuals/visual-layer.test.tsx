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
  return { id: `v-${kind}`, sheetId: "s1", anchor: ANCHOR, generation: 1, ...body, ...overrides };
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
  it("draws a file chart of an unpreviewed type and an oversized file picture as named placeholders", () => {
    setup([
      { visual: { id: "f0", sheetId: "s1", anchor: ANCHOR, generation: 0, file: 0, kind: "chart", title: "Radar 2026" }, box: BOX },
      { visual: { id: "f1", sheetId: "s1", anchor: ANCHOR, generation: 0, file: 1, kind: "picture" }, box: BOX },
    ]);
    expect(screen.getByRole("button", { name: "Chart Radar 2026" })).toHaveTextContent("This chart type has no preview here yet.");
    expect(screen.getByRole("button", { name: "Picture" })).toHaveTextContent("This picture is too large to preview here.");
  });

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
    ["fixed file", { file: 2, fixed: true as const }, false, "anchored in a way the editor cannot move yet"],
    ["read-only", {}, true, "the document is read-only or a save is in progress"],
  ])("locks a %s visual", (_name, overrides, readOnly, why) => {
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
    expect(help).toHaveTextContent(why);
    expect(el).toHaveAttribute("title", expect.stringContaining(why));
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 130, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 130, clientY: 110, pointerId: 1 });
    expect(props.onMove).not.toHaveBeenCalled();
  });

  describe("Delete on a selected visual", () => {
    const selectedItem = { visual: visual("picture"), box: BOX };

    it("removes it when the key lands on the document, like the trash button", () => {
      const { props } = setup([selectedItem], { selectedId: "v-picture" });
      // A press on the item does not focus it, so the key goes to the body.
      const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      expect(props.onRemove).toHaveBeenCalledTimes(1);
      expect(props.onRemove).toHaveBeenCalledWith(selectedItem.visual);
      expect(event.defaultPrevented).toBe(true);
      fireEvent.keyDown(document.body, { key: "Backspace" });
      expect(props.onRemove).toHaveBeenCalledTimes(2);
    });

    it("never reaches a grid listener below the document", () => {
      setup([selectedItem], { selectedId: "v-picture" });
      const grid = document.createElement("div");
      document.body.append(grid);
      const seen = vi.fn();
      grid.addEventListener("keydown", seen);
      fireEvent.keyDown(grid, { key: "Delete" });
      expect(seen).not.toHaveBeenCalled();
      grid.remove();
    });

    // Review r3 F1: with a cell selected, focus sits on Univer's own
    // contenteditable editor input inside the grid surface.
    function gridFocusTarget() {
      const surface = document.createElement("div");
      surface.setAttribute("data-xlsx-grid-surface", "");
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      editor.dataset.uComp = "editor";
      surface.append(editor);
      document.body.append(surface);
      const below = vi.fn();
      editor.addEventListener("keydown", below);
      return { editor, below, remove: () => surface.remove() };
    }

    it("removes it from the grid's own focus target when no cell edit is open, and the grid never hears the key", () => {
      const { props } = setup([selectedItem], { selectedId: "v-picture", isCellEditing: () => false });
      const grid = gridFocusTarget();
      fireEvent.keyDown(grid.editor, { key: "Delete" });
      expect(props.onRemove).toHaveBeenCalledWith(selectedItem.visual);
      expect(grid.below).not.toHaveBeenCalled();
      grid.remove();
    });

    it("removes it from the grid's focus target when the renderer cannot tell (a visual selected means no cell edit)", () => {
      const { props } = setup([selectedItem], { selectedId: "v-picture" });
      const grid = gridFocusTarget();
      fireEvent.keyDown(grid.editor, { key: "Backspace" });
      expect(props.onRemove).toHaveBeenCalledTimes(1);
      grid.remove();
    });

    it("leaves the key to an open cell edit in the grid", () => {
      const { props } = setup([selectedItem], { selectedId: "v-picture", isCellEditing: () => true });
      const grid = gridFocusTarget();
      fireEvent.keyDown(grid.editor, { key: "Delete" });
      expect(props.onRemove).not.toHaveBeenCalled();
      expect(grid.below).toHaveBeenCalledTimes(1);
      grid.remove();
    });

    // Visual r3 R2a: Univer's ShortcutService listens for keydown on the
    // window's capture phase, registered when the renderer mounts (before any
    // host listener), and runs its Delete/Backspace "clear contents" shortcut
    // for any target inside its containers. This models that dispatch rule.
    // The layer renders into the surface first (a React root clears its
    // container); the renderer then mounts its own root beside it.
    function rendererWithShortcuts(mountLayer: (surface: HTMLElement) => void) {
      const surface = document.createElement("div");
      surface.setAttribute("data-xlsx-grid-surface", "");
      document.body.append(surface);
      mountLayer(surface);
      const container = document.createElement("div");
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      editor.dataset.uComp = "editor";
      container.append(editor);
      surface.append(container);
      const clearCells = vi.fn();
      const shortcut = (event: KeyboardEvent) => {
        if ((event.key !== "Delete" && event.key !== "Backspace") || !container.contains(event.target as Node)) return;
        clearCells();
        event.preventDefault();
      };
      window.addEventListener("keydown", shortcut, true);
      editor.focus();
      const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });
      const remove = () => { window.removeEventListener("keydown", shortcut, true); surface.remove(); };
      return { surface, editor, clearCells, press, remove };
    }

    function setupInSurface(overrides: Partial<XlsxVisualLayerProps> = {}, selectedId: string | null = "v-picture") {
      const props = { onSelect: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(), ...overrides };
      const grid = rendererWithShortcuts((surface) => {
        render(<XlsxVisualLayer items={[selectedItem]} selectedId={selectedId} readOnly={false} {...props} />, { container: surface });
      });
      return { props, grid };
    }

    it.each(["Delete", "Backspace"])("a press on the item moves focus off the grid, so %s removes the visual and never clears cells", (key) => {
      const { props, grid } = setupInSurface({ isCellEditing: () => false });
      const item = screen.getByTestId("xlsx-visual-item-picture");
      fireEvent.pointerDown(item, { clientX: 150, clientY: 150, pointerId: 1, button: 0 });
      fireEvent.pointerUp(item, { clientX: 150, clientY: 150, pointerId: 1 });
      expect(document.activeElement).toBe(item);
      grid.press(key);
      expect(grid.clearCells).not.toHaveBeenCalled();
      expect(props.onRemove).toHaveBeenCalledTimes(1);
      expect(props.onRemove).toHaveBeenCalledWith(selectedItem.visual);
      // Focus goes back to the grid, inside the editor root, so Ctrl+Z
      // reaches the undo that restores the visual; the selection goes too.
      expect(document.activeElement).toBe(grid.editor);
      expect(props.onSelect).toHaveBeenLastCalledWith(null);
      grid.remove();
    });

    it("the trash button hands focus back to the grid after removing", () => {
      const { props, grid } = setupInSurface();
      const trash = screen.getByTestId("xlsx-visual-delete");
      act(() => trash.focus());
      fireEvent.click(trash);
      expect(props.onRemove).toHaveBeenCalledWith(selectedItem.visual);
      expect(document.activeElement).toBe(grid.editor);
      grid.remove();
    });

    it("a press on a handle focuses the item too", () => {
      const { grid } = setupInSurface();
      const handle = screen.getByTestId("xlsx-visual-handle-se");
      fireEvent.pointerDown(handle, { clientX: 220, clientY: 180, pointerId: 1, button: 0 });
      fireEvent.pointerUp(handle, { clientX: 220, clientY: 180, pointerId: 1 });
      expect(document.activeElement).toBe(screen.getByTestId("xlsx-visual-item-picture"));
      grid.remove();
    });

    it("focus moving from the item into the grid clears the selection; Delete there still clears cells", () => {
      const { props, grid } = setupInSurface();
      const item = screen.getByTestId("xlsx-visual-item-picture");
      act(() => item.focus());
      act(() => grid.editor.focus());
      expect(props.onSelect).toHaveBeenLastCalledWith(null);
      const outside = document.createElement("button");
      document.body.append(outside);
      vi.mocked(props.onSelect).mockClear();
      act(() => item.focus());
      act(() => outside.focus());
      expect(props.onSelect).not.toHaveBeenCalledWith(null);
      outside.remove();
      grid.remove();
    });

    it("leaves Delete to the grid when no visual is selected", () => {
      const { props, grid } = setupInSurface({}, null);
      grid.press("Delete");
      expect(grid.clearCells).toHaveBeenCalledTimes(1);
      expect(props.onRemove).not.toHaveBeenCalled();
      grid.remove();
    });

    it("is ignored while typing, with a modifier, without a selection, read-only or on a file-locked visual", () => {
      const { props: { selectedId: _selected, ...handlers }, rerender } = setup([selectedItem], { selectedId: "v-picture" });
      const props = handlers;
      const input = document.createElement("input");
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      document.body.append(input, editor);
      fireEvent.keyDown(input, { key: "Delete" });
      fireEvent.keyDown(editor, { key: "Backspace" });
      fireEvent.keyDown(document.body, { key: "Delete", ctrlKey: true });
      fireEvent.keyDown(document.body, { key: "a" });
      expect(props.onRemove).not.toHaveBeenCalled();
      input.remove();
      editor.remove();
      rerender(<XlsxVisualLayer items={[selectedItem]} selectedId={null} readOnly={false} {...props} />);
      fireEvent.keyDown(document.body, { key: "Delete" });
      rerender(<XlsxVisualLayer items={[selectedItem]} selectedId="v-picture" readOnly {...props} />);
      fireEvent.keyDown(document.body, { key: "Delete" });
      rerender(<XlsxVisualLayer items={[{ ...selectedItem, visual: { ...selectedItem.visual, fixed: true } }]} selectedId="v-picture" readOnly={false} {...props} />);
      fireEvent.keyDown(document.body, { key: "Delete" });
      expect(props.onRemove).not.toHaveBeenCalled();
    });
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
