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
    sheets: SHEETS,
    activeSheet: "Data",
    defaultSheetName: "Sheet",
    onOpenFind: vi.fn(),
    onInsertSheet: vi.fn(),
    onSelectSheet: vi.fn(),
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
    render(<Harness enabled={false} onOpenFind={onOpenFind} onInsertSheet={onInsertSheet} />);
    const root = screen.getByTestId("root");
    fireEvent.keyDown(root, { key: "f", ctrlKey: true });
    fireEvent.keyDown(root, { key: "F11", shiftKey: true });
    expect(onOpenFind).not.toHaveBeenCalled();
    expect(onInsertSheet).not.toHaveBeenCalled();
  });

  it("leaves the keys to a focused text control", () => {
    const onOpenFind = vi.fn();
    const onInsertSheet = vi.fn();
    render(<Harness onOpenFind={onOpenFind} onInsertSheet={onInsertSheet} />);
    const input = document.createElement("input");
    screen.getByTestId("root").appendChild(input);
    fireEvent.keyDown(input, { key: "f", ctrlKey: true, bubbles: true });
    fireEvent.keyDown(input, { key: "F11", shiftKey: true, bubbles: true });
    expect(onOpenFind).not.toHaveBeenCalled();
    expect(onInsertSheet).not.toHaveBeenCalled();
  });
});