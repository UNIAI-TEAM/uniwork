import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useXlsxCatalogShortcuts, type XlsxCatalogShortcutOptions } from "./use-catalog-shortcuts";

const SHEETS = [
  { name: "Data", hidden: false },
  { name: "Summary", hidden: false },
  { name: "Hidden", hidden: true },
];

function Harness(props: Partial<XlsxCatalogShortcutOptions> = {}) {
  const rootRef = createRef<HTMLDivElement>();
  const options: XlsxCatalogShortcutOptions = {
    enabled: true,
    rootRef,
    documentKey: "doc",
    canFind: true,
    canEdit: true,
    canRedo: true,
    sheets: SHEETS,
    activeSheet: "Data",
    defaultSheetName: "Sheet",
    onOpenFind: vi.fn(),
    onInsertSheet: vi.fn(),
    onSelectSheet: vi.fn(),
    onRedo: vi.fn(),
    ...props,
  };
  useXlsxCatalogShortcuts(options);
  return <div ref={rootRef} data-testid="root" tabIndex={-1} />;
}

describe("useXlsxCatalogShortcuts", () => {
  it("opens find on Ctrl/Cmd+F only when a grid is mounted", () => {
    const onOpenFind = vi.fn();
    const view = render(<Harness onOpenFind={onOpenFind} />);
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    screen.getByTestId("root").dispatchEvent(event);
    expect(onOpenFind).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);

    onOpenFind.mockClear();
    view.rerender(<Harness canFind={false} onOpenFind={onOpenFind} />);
    screen.getByTestId("root").dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onOpenFind).not.toHaveBeenCalled();
  });

  it("redoes on Ctrl/Cmd+Shift+Z when the grid has a redo stack", () => {
    const onRedo = vi.fn();
    render(<Harness onRedo={onRedo} />);
    const root = screen.getByTestId("root");
    const chord = new KeyboardEvent("keydown", { key: "Z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    root.dispatchEvent(chord);
    expect(onRedo).toHaveBeenCalledOnce();
    expect(chord.defaultPrevented).toBe(true);
    // Cmd on mac and the lowercase key both count.
    fireEvent.keyDown(root, { key: "z", metaKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(2);
  });

  it("leaves Ctrl+Z (undo) and Ctrl+Y (redo) to the pinned grid", () => {
    const onRedo = vi.fn();
    render(<Harness onRedo={onRedo} />);
    const root = screen.getByTestId("root");
    // No shift: the pinned bundle owns undo/redo; the hook must stay out.
    fireEvent.keyDown(root, { key: "z", ctrlKey: true });
    fireEvent.keyDown(root, { key: "y", ctrlKey: true });
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("refuses the redo chord when the grid has no redo stack", () => {
    const onRedo = vi.fn();
    render(<Harness canRedo={false} onRedo={onRedo} />);
    fireEvent.keyDown(screen.getByTestId("root"), { key: "Z", ctrlKey: true, shiftKey: true });
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("inserts a uniquely named sheet on Shift+F11 when editing is allowed", () => {
    const onInsertSheet = vi.fn();
    render(<Harness onInsertSheet={onInsertSheet} />);
    fireEvent.keyDown(screen.getByTestId("root"), { key: "F11", shiftKey: true });
    expect(onInsertSheet).toHaveBeenCalledWith("Sheet");
    onInsertSheet.mockClear();
    fireEvent.keyDown(screen.getByTestId("root"), { key: "F11", shiftKey: true, ctrlKey: true });
    expect(onInsertSheet).toHaveBeenCalledWith("Sheet");
  });

  it("refuses Shift+F11 while read-only", () => {
    const onInsertSheet = vi.fn();
    render(<Harness canEdit={false} onInsertSheet={onInsertSheet} />);
    fireEvent.keyDown(screen.getByTestId("root"), { key: "F11", shiftKey: true });
    expect(onInsertSheet).not.toHaveBeenCalled();
  });

  it("switches to the next/previous visible sheet and does not wrap", () => {
    const onSelectSheet = vi.fn();
    const view = render(<Harness activeSheet="Data" onSelectSheet={onSelectSheet} />);
    const root = () => screen.getByTestId("root");
    fireEvent.keyDown(root(), { key: "PageDown", ctrlKey: true });
    expect(onSelectSheet).toHaveBeenLastCalledWith("Summary");
    // The editor feeds the live active sheet back in; PageUp returns to it.
    view.rerender(<Harness activeSheet="Summary" onSelectSheet={onSelectSheet} />);
    fireEvent.keyDown(root(), { key: "PageUp", ctrlKey: true });
    expect(onSelectSheet).toHaveBeenLastCalledWith("Data");
    // Already on the first visible tab: Excel does not wrap.
    onSelectSheet.mockClear();
    view.rerender(<Harness activeSheet="Data" onSelectSheet={onSelectSheet} />);
    fireEvent.keyDown(root(), { key: "PageUp", ctrlKey: true });
    expect(onSelectSheet).not.toHaveBeenCalled();
  });

  it("binds nothing while the document is not ready", () => {
    const onOpenFind = vi.fn();
    const onInsertSheet = vi.fn();
    const onRedo = vi.fn();
    render(<Harness enabled={false} onOpenFind={onOpenFind} onInsertSheet={onInsertSheet} onRedo={onRedo} />);
    const root = screen.getByTestId("root");
    fireEvent.keyDown(root, { key: "f", ctrlKey: true });
    fireEvent.keyDown(root, { key: "F11", shiftKey: true });
    fireEvent.keyDown(root, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(onOpenFind).not.toHaveBeenCalled();
    expect(onInsertSheet).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("leaves the keys to a focused text control", () => {
    const onOpenFind = vi.fn();
    const onInsertSheet = vi.fn();
    const onRedo = vi.fn();
    render(<Harness onOpenFind={onOpenFind} onInsertSheet={onInsertSheet} onRedo={onRedo} />);
    const input = document.createElement("input");
    screen.getByTestId("root").appendChild(input);
    fireEvent.keyDown(input, { key: "f", ctrlKey: true, bubbles: true });
    fireEvent.keyDown(input, { key: "F11", shiftKey: true, bubbles: true });
    fireEvent.keyDown(input, { key: "Z", ctrlKey: true, shiftKey: true, bubbles: true });
    expect(onOpenFind).not.toHaveBeenCalled();
    expect(onInsertSheet).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });
});
