import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { XlsxEditor } from "./xlsx-editor";
import type { XlsxGridSurfaceProps } from "./xlsx-grid-surface";
import type { XlsxEditorHandle, XlsxSaveCoordinator, XlsxWorkbookSnapshot } from "./types";

const grid = vi.hoisted(() => ({
  props: null as XlsxGridSurfaceProps | null,
  handle: {
    undo: vi.fn(), redo: vi.fn(), selectSheet: vi.fn(), setNumberFormat: vi.fn(), setCellText: vi.fn(), commitEdit: vi.fn(async () => undefined),
    executeCommand: vi.fn(() => true), getActiveFormatState: vi.fn((): unknown => null),
  },
}));
vi.mock("./xlsx-grid-surface", async () => {
  const React = await import("react");
  return { XlsxGridSurface: (props: XlsxGridSurfaceProps) => {
    grid.props = props;
    React.useImperativeHandle(props.ref, () => grid.handle as never);
    const onReady = React.useRef(props.onReady);
    React.useEffect(() => { onReady.current?.(); }, []);
    return <button type="button" data-testid="live-grid" onKeyDown={(event) => event.stopPropagation()} />;
  } };
});

/** The shared ribbon tab by id (the ribbon owns its own DOM, so no per-lane
 *  testid survives the migration). */
function ribbonTab(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-ribbon-tab="${id}"]`)!;
}

function setup(editDelay?: Promise<void>, readOnly = false, saving = false, embedded = false) {
  let snapshot: XlsxWorkbookSnapshot = { revision: 1, sheets: [
    { id: "sheet-1", name: "Data", cells: { A1: { value: 2 } } },
    { id: "sheet-2", name: "Summary", cells: { A1: { value: 4, formula: "=Data!A1*2" } } },
  ] };
  let generation = 0;
  const edit = vi.fn(async (operations: readonly unknown[]) => {
    await editDelay;
    generation += 1;
    for (const raw of operations) {
      const op = raw as { target: { sheet: string; cell: string }; attributes?: { value?: number; formula?: string } };
      const sheet = snapshot.sheets.find((s) => s.name === op.target.sheet)!;
      snapshot = { ...snapshot, revision: snapshot.revision + 1, sheets: snapshot.sheets.map((s) => s === sheet ? { ...s, cells: { ...s.cells, [op.target.cell]: op.attributes?.formula ? { value: null, formula: op.attributes.formula } : { value: op.attributes?.value ?? 2 } } } : s) };
    }
  });
  const handle: XlsxEditorHandle = {
    format: "xlsx", open: async () => undefined, dispose: vi.fn(),
    edit, getDirtyGeneration: () => generation, getWorkbookSnapshot: () => snapshot,
    captureSnapshot: async () => ({ generation, fingerprint: "fp", value: snapshot }),
    selection: { getSelection: () => ({ sheet: "Data", address: "A1" }), setSelection: vi.fn() },
    clipboard: { readText: vi.fn(async () => "3\t4\n5\t6"), writeText: vi.fn(async () => undefined) },
  };
  const state = { state: saving ? "saving" : "dirty", identity: {}, dirtyGeneration: 1, lastSavedGeneration: 0, activeIntentId: null, error: null } as ReturnType<XlsxSaveCoordinator["getState"]>;
  const coordinator: XlsxSaveCoordinator = { getState: () => state, subscribe: () => () => undefined, markDirty: vi.fn(), cancel: vi.fn(async () => undefined), save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })) };
  const host = { file: { sheets: snapshot.sheets, readOnly: false }, readRange: async () => ({}) } as never;
  grid.handle.selectSheet.mockImplementation((sheetId: string) => grid.props?.onSelectionChange?.({ sheetId, range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }));
  const view = render(<XlsxEditor documentKey="grid-doc" editor={handle} coordinator={coordinator} rendererHost={host} embedded={embedded} permissions={{ canEdit: !readOnly }} open={{ open: async () => ({ outcome: "opened", document_id: "doc", document_model_ref: "model", snapshot }) }} />);
  return { view, handle, coordinator, edit };
}

describe("XlsxEditor live grid commands", () => {
  it("captures Save from a grid editor that stops keydown propagation and commits it before capture", async () => {
    const { coordinator } = setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    grid.handle.commitEdit.mockClear();
    fireEvent.keyDown(screen.getByTestId("live-grid"), { key: "s", ctrlKey: true });
    await waitFor(() => expect(coordinator.save).toHaveBeenCalledWith("shortcut"));
    expect(grid.handle.commitEdit).toHaveBeenCalledOnce();
    expect(grid.handle.commitEdit.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(coordinator.save).mock.invocationCallOrder[0]!);
  });
  it("copies selected ranges and sends tabular clipboard text to distinct grid cells", async () => {
    const { handle } = setup();
    await screen.findByTestId("live-grid");
    act(() => grid.props?.onSelectionChange?.({ sheetId: "sheet-1", range: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 } }));
    const toolbar = within(screen.getByTestId("xlsx-toolbar"));
    fireEvent.click(toolbar.getByRole("button", { name: /^Sao chép ô/ }));
    expect(handle.clipboard?.writeText).toHaveBeenCalledWith("2\t\n\t");
    grid.handle.setCellText.mockClear();
    fireEvent.click(toolbar.getByRole("button", { name: /^Dán/ }));
    await waitFor(() => expect(grid.handle.setCellText).toHaveBeenCalledTimes(4));
    expect(grid.handle.setCellText.mock.calls).toEqual([["sheet-1", 0, 0, "3"], ["sheet-1", 0, 1, "4"], ["sheet-1", 1, 0, "5"], ["sheet-1", 1, 1, "6"]]);
  });

  it("shows indeterminate Save progress and cancels the actual coordinator", async () => {
    const { coordinator } = setup(undefined, false, true);
    await screen.findByTestId("live-grid");
    expect(screen.getByTestId("xlsx-save-progress")).not.toHaveAttribute("value");
    expect(screen.getByRole("progressbar")).toHaveAccessibleName();
    fireEvent.click(screen.getByTestId("xlsx-save-cancel"));
    expect(coordinator.cancel).toHaveBeenCalledOnce();
    expect(screen.getByTestId("xlsx-save")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("xlsx-save"));
    expect(coordinator.save).not.toHaveBeenCalled();
  });

  it("does not paste late clipboard text into a replacement editing session", async () => {
    const { view, handle, coordinator } = setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    let finish!: (text: string) => void;
    vi.mocked(handle.clipboard!.readText!).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: /^Dán/ }));
    const snapshot: XlsxWorkbookSnapshot = { revision: 2, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 9 } } }] };
    const replacement = { ...handle, getWorkbookSnapshot: () => snapshot, dispose: vi.fn() };
    view.rerender(<XlsxEditor documentKey="grid-doc" editor={replacement} coordinator={coordinator} rendererHost={grid.props!.host} open={{ open: async () => ({ outcome: "opened", document_id: "doc", document_model_ref: "replacement", snapshot }) }} />);
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    grid.handle.setCellText.mockClear();
    await act(async () => { finish("unexpected"); await Promise.resolve(); });
    expect(grid.handle.setCellText).not.toHaveBeenCalled();
  });

  it("leaves embedded title and Save ownership with the shared host while retaining Save cancellation", async () => {
    const { coordinator } = setup(undefined, false, true, true);
    await screen.findByTestId("live-grid");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-save")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAccessibleName();
    fireEvent.click(screen.getByTestId("xlsx-save-cancel"));
    expect(coordinator.cancel).toHaveBeenCalledOnce();
  });

  it("keeps numeric edits ordered and waits for the host queue before Save", async () => {
    let release!: () => void;
    const delay = new Promise<void>((resolve) => { release = resolve; });
    const { edit, coordinator } = setup(delay);
    await screen.findByTestId("live-grid");
    act(() => grid.props?.onEdits?.([{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: 42 }]));
    await waitFor(() => expect(edit).toHaveBeenCalledWith([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 42 } }]));
    fireEvent.keyDown(screen.getByTestId("xlsx-editor"), { key: "s", ctrlKey: true });
    expect(coordinator.save).not.toHaveBeenCalled();
    await act(async () => { release(); await delay; });
    await waitFor(() => expect(coordinator.save).toHaveBeenCalledWith("shortcut"));
    expect(coordinator.markDirty).toHaveBeenCalledWith(1);
    expect(screen.getByTestId("xlsx-formula-bar")).toHaveValue("42");
  });

  it("routes formula text, sheets, formats, undo and redo to the mounted grid", async () => {
    setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByRole("button", { name: "Định dạng số" })).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(grid.handle.selectSheet).toHaveBeenLastCalledWith("sheet-2");
    const formula = screen.getByTestId("xlsx-formula-bar");
    fireEvent.change(formula, { target: { value: "=Data!A1*3" } });
    fireEvent.keyDown(formula, { key: "Enter" });
    expect(grid.handle.setCellText).toHaveBeenLastCalledWith("sheet-2", 0, 0, "=Data!A1*3");
    fireEvent.click(screen.getByRole("button", { name: "Định dạng số" }));
    expect(grid.handle.setNumberFormat).toHaveBeenLastCalledWith("0.00");
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    fireEvent.click(screen.getByRole("button", { name: "Làm lại" }));
    expect(grid.handle.undo).toHaveBeenCalled();
    expect(grid.handle.redo).toHaveBeenCalled();
  });

  it("runs Home formatting commands on the live grid and mirrors the active format state", async () => {
    const formatState = {
      fontFamily: "Calibri", fontSize: 14, bold: true, italic: false, underline: false, strike: false,
      textColor: "#C00000", fillColor: null, horizontalAlign: 1, verticalAlign: 1, wrap: false, textRotation: 0,
    };
    grid.handle.getActiveFormatState.mockReturnValue(formatState);
    grid.handle.executeCommand.mockClear();
    setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    const bold = await screen.findByRole("button", { name: "In đậm" });
    expect(bold).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "In nghiêng" }));
    expect(grid.handle.executeCommand).toHaveBeenCalledWith("sheet.command.set-italic", undefined);
    expect(grid.handle.getActiveFormatState).toHaveBeenCalled();
    grid.handle.getActiveFormatState.mockReturnValue(null);
  });

  it("normalises a rejected command dispatch to a resolved false without an unhandled rejection", async () => {
    setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    // The port boundary folds a rejected dispatch into a resolved false, so the
    // fire-and-forget toolbar click never escapes as an unhandled rejection.
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => rejections.push(event.reason);
    window.addEventListener("unhandledrejection", onRejection);
    try {
      grid.handle.executeCommand.mockRejectedValueOnce(new Error("handler exploded"));
      expect(() => fireEvent.click(screen.getByRole("button", { name: "In nghi\u00eang" }))).not.toThrow();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(rejections).toHaveLength(0);
      expect(screen.getByTestId("xlsx-editor")).toBeInTheDocument();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  it("surfaces a rejected host edit and blocks Save", async () => {
    const { handle, coordinator } = setup();
    vi.mocked(handle.edit!).mockRejectedValueOnce(new Error("session unavailable"));
    await screen.findByTestId("live-grid");
    act(() => grid.props?.onEdits?.([{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: 42 }]));
    await screen.findByTestId("xlsx-edit-error");
    fireEvent.keyDown(screen.getByTestId("xlsx-editor"), { key: "s", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("xlsx-recalc-error")).toHaveTextContent("session unavailable"));
    expect(coordinator.save).not.toHaveBeenCalled();
  });

  it("propagates readonly to the grid and refuses edits and Save", async () => {
    const { edit, coordinator } = setup(undefined, true);
    await screen.findByTestId("live-grid");
    expect(grid.props?.readOnly).toBe(true);
    expect(screen.getByTestId("xlsx-formula-bar")).toBeDisabled();
    act(() => grid.props?.onEdits?.([{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: 42 }]));
    fireEvent.keyDown(screen.getByTestId("xlsx-editor"), { key: "s", ctrlKey: true });
    expect(edit).not.toHaveBeenCalled();
    expect(coordinator.save).not.toHaveBeenCalled();
  });

  it("permits read-only Copy while blocked Paste remains focusable and inert", async () => {
    const { handle } = setup(undefined, true);
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    const toolbar = within(screen.getByTestId("xlsx-toolbar"));
    fireEvent.click(toolbar.getByRole("button", { name: /^Sao chép ô/ }));
    expect(handle.clipboard?.writeText).toHaveBeenCalledWith("2");
    const paste = toolbar.getByRole("button", { name: /^Dán/ });
    expect(paste).toHaveAttribute("aria-disabled", "true");
    expect(paste).not.toBeDisabled();
    fireEvent.click(paste);
    expect(handle.clipboard?.readText).not.toHaveBeenCalled();
  });

  it("reports clipboard permission rejection without exposing browser exception text", async () => {
    const { handle } = setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    vi.mocked(handle.clipboard!.readText!).mockRejectedValueOnce(new Error("NotAllowedError: internal browser diagnostic"));
    fireEvent.click(within(screen.getByTestId("xlsx-toolbar")).getByRole("button", { name: /^Dán/ }));
    expect(await screen.findByTestId("xlsx-recalc-error")).toHaveTextContent("Kiểm tra quyền của trình duyệt");
    expect(screen.getByTestId("xlsx-recalc-error")).not.toHaveTextContent("NotAllowedError");
  });

  it("exposes the same commands in English", async () => {
    await setLocale("en");
    setup();
    await screen.findByTestId("live-grid");
    expect(screen.getByRole("button", { name: "Number format" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-save")).toHaveTextContent("Save");
  });
});

describe("XlsxEditor context menu and shortcuts", () => {
  it("opens the context menu from a right-click and runs a command through the grid port", async () => {
    setup();
    await screen.findByTestId("live-grid");
    act(() => grid.props?.onSelectionChange?.({ sheetId: "sheet-1", range: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 } }));
    const container = screen.getByTestId("live-grid");
    act(() => grid.props?.onContextMenu?.({ x: 10, y: 20 }, container));
    const menu = await screen.findByTestId("xlsx-context-menu");
    grid.handle.executeCommand.mockClear();
    fireEvent.click(within(menu).getByTestId("xlsx-context-insert-row-above"));
    expect(grid.handle.executeCommand).toHaveBeenCalledWith("sheet.command.insert-row-before", { value: 2 });
  });

  it("cuts by copying the selection then clearing it through the allowlisted command", async () => {
    const { handle } = setup();
    await screen.findByTestId("live-grid");
    act(() => grid.props?.onSelectionChange?.({ sheetId: "sheet-1", range: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 } }));
    const container = screen.getByTestId("live-grid");
    act(() => grid.props?.onContextMenu?.({ x: 1, y: 1 }, container));
    const menu = await screen.findByTestId("xlsx-context-menu");
    grid.handle.executeCommand.mockClear();
    fireEvent.click(within(menu).getByTestId("xlsx-context-cut"));
    await waitFor(() => expect(handle.clipboard?.writeText).toHaveBeenCalled());
    await waitFor(() => expect(grid.handle.executeCommand).toHaveBeenCalledWith("sheet.command.clear-selection-content", undefined));
  });

  it("opens find, inserts a sheet and switches sheets from the catalog keys", async () => {
    setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    // Ctrl+F: the pinned find dialog is policy-denied, so the editor panel is
    // the real target (the help must not promise a dead key).
    fireEvent.keyDown(screen.getByTestId("xlsx-editor"), { key: "f", ctrlKey: true });
    expect(await screen.findByTestId("xlsx-find-panel")).toBeInTheDocument();
    // Shift+F11: insert a sheet through the pinned command.
    grid.handle.executeCommand.mockClear();
    fireEvent.keyDown(screen.getByTestId("xlsx-editor"), { key: "F11", shiftKey: true });
    expect(grid.handle.executeCommand).toHaveBeenCalledWith("sheet.command.insert-sheet", expect.objectContaining({ sheet: expect.any(Object) }));
    // Ctrl+PageDown: activate the next visible sheet tab.
    fireEvent.keyDown(screen.getByTestId("xlsx-editor"), { key: "PageDown", ctrlKey: true });
    expect(grid.handle.selectSheet).toHaveBeenLastCalledWith("sheet-2");
    // Ctrl+Shift+Z: the advertised redo alternate chord (upstream binds only
    // Ctrl+Y), routed to the live grid's redo stack.
    grid.handle.redo.mockClear();
    fireEvent.keyDown(screen.getByTestId("xlsx-editor"), { key: "Z", ctrlKey: true, shiftKey: true });
    expect(grid.handle.redo).toHaveBeenCalledOnce();
  });

  it("surfaces a refused sheet action instead of silently no-opping", async () => {
    const { handle } = setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    // Shift+F11 inserts a sheet through the pinned command; a resolved false is
    // fail-closed: the direct-op fallback is NOT retried (it would bypass the
    // policy gate) and the failure is surfaced instead of silent.
    grid.handle.executeCommand.mockResolvedValueOnce(false);
    vi.mocked(handle.edit!).mockClear();
    fireEvent.keyDown(screen.getByTestId("xlsx-editor"), { key: "F11", shiftKey: true });
    await waitFor(() => expect(screen.getByTestId("xlsx-recalc-error")).toBeInTheDocument());
    expect(handle.edit).not.toHaveBeenCalled();
  });

  it("leaves catalog keys to the cell editor while it owns the keyboard", async () => {
    setup();
    await screen.findByTestId("live-grid");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    // The formula bar is a text control inside the editor root; the pinned
    // sheets-ui binds its shortcuts with `whenSheetEditorFocused`, so Ctrl+F
    // must not steal the key there.
    fireEvent.keyDown(screen.getByTestId("xlsx-formula-bar"), { key: "f", ctrlKey: true, bubbles: true });
    expect(screen.queryByTestId("xlsx-find-panel")).not.toBeInTheDocument();
  });

  it("opens the shortcuts dialog from the View tab entry", async () => {
    setup();
    await screen.findByTestId("live-grid");
    fireEvent.click(ribbonTab("view"));
    fireEvent.click(screen.getByTestId("xlsx-shortcuts-open"));
    expect(await screen.findByTestId("xlsx-shortcuts")).toBeInTheDocument();
  });
});
