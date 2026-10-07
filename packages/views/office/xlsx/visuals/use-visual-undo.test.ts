import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useVisualUndo } from "./use-visual-undo";
import type { XlsxVisualsHistory } from "./use-xlsx-visuals";

const visualSide = (canUndo: boolean, canRedo: boolean, selected = false): XlsxVisualsHistory => ({ canUndo, canRedo, selected, undo: vi.fn(), redo: vi.fn() });
const side = (canUndo: boolean, canRedo: boolean) => ({ canUndo, canRedo, undo: vi.fn(), redo: vi.fn() });

describe("useVisualUndo", () => {
  it("is enabled by either stack and prefers the visual step", () => {
    const visuals = visualSide(true, true);
    const grid = side(true, true);
    const { result } = renderHook(() => useVisualUndo(visuals, grid));
    expect(result.current.canUndo && result.current.canRedo).toBe(true);
    result.current.undo();
    result.current.redo();
    expect(visuals.undo).toHaveBeenCalledTimes(1);
    expect(visuals.redo).toHaveBeenCalledTimes(1);
    expect(grid.undo).not.toHaveBeenCalled();
    expect(grid.redo).not.toHaveBeenCalled();
  });

  it("falls back to the grid, and stays disabled when neither has a step", () => {
    const visuals = visualSide(false, false);
    const grid = side(true, false);
    const { result } = renderHook(() => useVisualUndo(visuals, grid));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    result.current.undo();
    expect(grid.undo).toHaveBeenCalledTimes(1);
    expect(visuals.undo).not.toHaveBeenCalled();
    const idle = renderHook(() => useVisualUndo(visualSide(false, false), side(false, false)));
    expect(idle.result.current.canUndo || idle.result.current.canRedo).toBe(false);
  });
});

describe("useVisualUndo keyboard", () => {
  // Review r3 F2: one undo order like Excel. After a visual move or delete,
  // focus is back on the grid's contenteditable editor input with nothing
  // selected; Ctrl+Z must still take the visual step first.
  function gridEditor(root: HTMLElement) {
    const surface = document.createElement("div");
    surface.setAttribute("data-xlsx-grid-surface", "");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.dataset.uComp = "editor";
    surface.append(editor);
    root.append(surface);
    return editor;
  }

  function mount(visuals: XlsxVisualsHistory, isCellEditing?: () => boolean | null) {
    const root = document.createElement("div");
    document.body.append(root);
    const grid = { ...side(true, true), ...(isCellEditing ? { isCellEditing } : {}) };
    const hook = renderHook(() => useVisualUndo(visuals, grid, { rootRef: { current: root }, documentKey: "d" }));
    const press = (target: Element, init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      const below = vi.fn();
      target.addEventListener("keydown", below);
      target.dispatchEvent(event);
      return { event, below };
    };
    return { root, press, hook, grid };
  }

  it("runs the visual undo and redo before the grid hears Ctrl+Z, Cmd+Z, Ctrl+Y and Ctrl+Shift+Z", () => {
    const visuals = visualSide(true, true);
    const { root, press } = mount(visuals);
    const body = press(root, { key: "z", ctrlKey: true });
    expect(visuals.undo).toHaveBeenCalledTimes(1);
    expect(body.event.defaultPrevented).toBe(true);
    expect(body.below).not.toHaveBeenCalled();
    press(root, { key: "z", metaKey: true });
    expect(visuals.undo).toHaveBeenCalledTimes(2);
    press(root, { key: "y", ctrlKey: true });
    press(root, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(visuals.redo).toHaveBeenCalledTimes(2);
    root.remove();
  });

  it("leaves the key to the grid when the visual step is not the next one or the chord is not undo", () => {
    const visuals = visualSide(false, false);
    const { root, press } = mount(visuals);
    const plain = press(root, { key: "z", ctrlKey: true });
    expect(plain.event.defaultPrevented).toBe(false);
    expect(plain.below).toHaveBeenCalled();
    press(root, { key: "y", ctrlKey: true });
    expect(visuals.undo).not.toHaveBeenCalled();
    expect(visuals.redo).not.toHaveBeenCalled();
    root.remove();
  });

  it("never steals the key from a form control or a cell edit with nothing selected", () => {
    const visuals = visualSide(true, true);
    const { root, press } = mount(visuals);
    const input = document.createElement("input");
    const cell = document.createElement("div");
    cell.setAttribute("contenteditable", "true");
    root.append(input, cell);
    expect(press(input, { key: "z", ctrlKey: true }).event.defaultPrevented).toBe(false);
    expect(press(cell, { key: "z", ctrlKey: true }).event.defaultPrevented).toBe(false);
    expect(press(root, { key: "z", ctrlKey: true, altKey: true }).event.defaultPrevented).toBe(false);
    expect(visuals.undo).not.toHaveBeenCalled();
    root.remove();
  });

  it("takes the key over the grid's editor input once a visual is selected when the renderer cannot tell", () => {
    const visuals = visualSide(true, false, true);
    const { root, press } = mount(visuals);
    const cell = gridEditor(root);
    expect(press(cell, { key: "z", ctrlKey: true }).event.defaultPrevented).toBe(true);
    expect(visuals.undo).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("takes the visual step from the grid's focus target with nothing selected while no cell edit is open", () => {
    const visuals = visualSide(true, true);
    const { root, press } = mount(visuals, () => false);
    const editor = gridEditor(root);
    const undo = press(editor, { key: "z", ctrlKey: true });
    expect(visuals.undo).toHaveBeenCalledTimes(1);
    expect(undo.event.defaultPrevented).toBe(true);
    expect(undo.below).not.toHaveBeenCalled();
    press(editor, { key: "y", ctrlKey: true });
    expect(visuals.redo).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("hands the key to the grid while a cell edit is open, even with a visual step next", () => {
    const visuals = visualSide(true, true, true);
    const { root, press } = mount(visuals, () => true);
    const editor = gridEditor(root);
    const undo = press(editor, { key: "z", ctrlKey: true });
    expect(undo.event.defaultPrevented).toBe(false);
    expect(undo.below).toHaveBeenCalledTimes(1);
    expect(visuals.undo).not.toHaveBeenCalled();
    root.remove();
  });
});
