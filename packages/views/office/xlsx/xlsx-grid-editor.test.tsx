import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { XlsxEditor } from "./xlsx-editor";
import type { XlsxGridSurfaceProps } from "./xlsx-grid-surface";
import type { XlsxEditorHandle, XlsxSaveCoordinator, XlsxWorkbookSnapshot } from "./types";

const grid = vi.hoisted(() => ({
  props: null as XlsxGridSurfaceProps | null,
  handle: { undo: vi.fn(), redo: vi.fn(), selectSheet: vi.fn(), setNumberFormat: vi.fn(), setCellText: vi.fn() },
}));
vi.mock("./xlsx-grid-surface", async () => {
  const React = await import("react");
  return { XlsxGridSurface: (props: XlsxGridSurfaceProps) => {
    grid.props = props;
    React.useImperativeHandle(props.ref, () => grid.handle as never);
    const onReady = React.useRef(props.onReady);
    React.useEffect(() => { onReady.current?.(); }, []);
    return <div data-testid="live-grid" />;
  } };
});

function setup(editDelay?: Promise<void>, readOnly = false, saving = false) {
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
  const view = render(<XlsxEditor documentKey="grid-doc" editor={handle} coordinator={coordinator} rendererHost={host} permissions={{ canEdit: !readOnly }} open={{ open: async () => ({ outcome: "opened", document_id: "doc", document_model_ref: "model", snapshot }) }} />);
  return { view, handle, coordinator, edit };
}

describe("XlsxEditor live grid commands", () => {
  it("copies selected ranges and sends tabular clipboard text to distinct grid cells", async () => {
    const { handle } = setup();
    await screen.findByTestId("live-grid");
    act(() => grid.props?.onSelectionChange?.({ sheetId: "sheet-1", range: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 } }));
    fireEvent.click(screen.getByRole("button", { name: /^Sao chép/ }));
    expect(handle.clipboard?.writeText).toHaveBeenCalledWith("2\t\n\t");
    grid.handle.setCellText.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Dán/ }));
    await waitFor(() => expect(grid.handle.setCellText).toHaveBeenCalledTimes(4));
    expect(grid.handle.setCellText.mock.calls).toEqual([["sheet-1", 0, 0, "3"], ["sheet-1", 0, 1, "4"], ["sheet-1", 1, 0, "5"], ["sheet-1", 1, 1, "6"]]);
  });

  it("shows indeterminate Save progress and cancels the actual coordinator", async () => {
    const { coordinator } = setup(undefined, false, true);
    await screen.findByTestId("live-grid");
    expect(screen.getByTestId("xlsx-save-progress")).not.toHaveAttribute("value");
    fireEvent.click(screen.getByTestId("xlsx-save-cancel"));
    expect(coordinator.cancel).toHaveBeenCalledOnce();
    expect(screen.getByTestId("xlsx-save")).toBeDisabled();
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Định dạng số" })).toBeEnabled());
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
