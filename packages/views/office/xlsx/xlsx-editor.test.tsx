import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OfficeHost } from "@uniwork/core/office";
import { EditorSlot } from "../editor-slot";
import type { XlsxCellState, XlsxEditorHandle, XlsxOpenOutcome, XlsxSaveCoordinator, XlsxSelection, XlsxWorkbookSnapshot } from "./types";
import { XlsxEditor } from "./xlsx-editor";
import { createXlsxEditorLoader } from "./xlsx-editor-slot";

/** The shared ribbon tab by id (the ribbon owns its own DOM, so no per-lane
 *  testid survives the migration). */
function ribbonTab(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-ribbon-tab="${id}"]`)!;
}

function coordinator(overrides: Partial<XlsxSaveCoordinator> = {}): XlsxSaveCoordinator {
  const state = {
    state: "dirty" as const,
    identity: {
      deploymentId: "dep",
      accountId: "account",
      organizationId: "org",
      workspaceId: "workspace",
      documentId: "doc",
      generation: 1,
      baseVersionId: "version",
      baseRevision: "1",
    },
    dirtyGeneration: 1,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    markDirty: vi.fn(),
    ...overrides,
  };
}

function workbook(): XlsxWorkbookSnapshot {
  return {
    revision: 1,
    sheets: [
      { id: "sheet-1", name: "Data", cells: {
        A1: { value: 2 },
        B1: { value: 3 },
        C1: { value: 5, formula: "=SUM(A1:B1)" },
      } satisfies Record<string, XlsxCellState> },
      { id: "sheet-2", name: "Summary", cells: { A1: { value: 5, formula: "=Data!C1" } } },
    ],
  };
}

function editor(overrides: Partial<XlsxEditorHandle> = {}): XlsxEditorHandle {
  let model = workbook();
  const selection: XlsxSelection = { sheet: "Data", address: "C1" };
  return {
    format: "xlsx",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 2,
    captureSnapshot: vi.fn(async () => ({ generation: 2, fingerprint: "fp", value: model })),
    getWorkbookSnapshot: () => model,
    edit: vi.fn((ops: readonly unknown[]) => {
      const op = ops[0] as { target?: { sheet?: string; cell?: string }; text?: string };
      if (op.target?.sheet && op.target.cell && typeof op.text === "string") {
        const sheet = model.sheets.find((candidate) => candidate.name === op.target?.sheet);
        if (sheet) {
          const cells = { ...sheet.cells };
          cells[op.target.cell] = op.text.startsWith("=") ? { value: null, formula: op.text } : { value: op.text };
          model = { ...model, sheets: model.sheets.map((candidate) => candidate === sheet ? { ...candidate, cells } : candidate) };
        }
      }
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    selection: {
      getSelection: () => selection,
      setSelection: vi.fn(),
      subscribe: () => () => undefined,
    },
    clipboard: {
      readText: vi.fn(async () => "=SUM(A1:B1)"),
      writeText: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

const opened = (documentId = "doc"): XlsxOpenOutcome => ({ outcome: "opened", document_id: documentId, document_model_ref: "model-1", snapshot: workbook() });

function renderEditor(outcome: XlsxOpenOutcome, options?: { key?: string; open?: () => Promise<XlsxOpenOutcome>; coordinator?: XlsxSaveCoordinator; editor?: XlsxEditorHandle }) {
  const handle = options?.editor ?? editor();
  const saveCoordinator = options?.coordinator ?? coordinator();
  const open = options?.open ?? vi.fn(async () => outcome);
  const view = render(<XlsxEditor documentKey={options?.key ?? "doc-v1"} editor={handle} open={{ open }} coordinator={saveCoordinator} />);
  return { handle, saveCoordinator, open, view };
}

describe("XlsxEditor", () => {
  it("opens replacement ports for the same document and releases the previous handle", async () => {
    const previous = editor();
    const previousCoordinator = coordinator({ cancel: vi.fn(async () => undefined) });
    const { view } = renderEditor(opened(), { editor: previous, coordinator: previousCoordinator });
    await screen.findByTestId("xlsx-workbook-surface");
    const initialSnapshot = workbook();
    const replacementSnapshot = { ...initialSnapshot, sheets: initialSnapshot.sheets.map((sheet, index) => index === 0 ? { ...sheet, cells: { ...sheet.cells, A1: { value: "replacement" } } } : sheet) };
    const replacement = editor({ getWorkbookSnapshot: () => replacementSnapshot });
    const replacementOpen = vi.fn(async () => ({ ...opened(), snapshot: replacementSnapshot }));
    view.rerender(<XlsxEditor documentKey="doc-v1" editor={replacement} open={{ open: replacementOpen }} coordinator={coordinator()} />);
    await waitFor(() => expect(screen.getByTestId("xlsx-cell-Data-A1")).toHaveTextContent("replacement"));
    expect(replacementOpen).toHaveBeenCalledOnce();
    expect(replacement.open).toHaveBeenCalledOnce();
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(previousCoordinator.cancel).toHaveBeenCalledOnce();
  });
  it("survives StrictMode effect replay and releases the session on real unmount", async () => {
    let disposed = false;
    const handle = editor({
      dispose: vi.fn(() => { disposed = true; }),
      open: vi.fn(async () => { if (disposed) throw new Error("xlsx_editor_disposed"); }),
    });
    const view = render(<StrictMode><XlsxEditor documentKey="doc" editor={handle} open={{ open: async () => opened() }} coordinator={coordinator()} /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    expect(handle.dispose).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(handle.dispose).toHaveBeenCalledTimes(1));
  });
  it("mounts the host handle, renders sheets/formula identity, and routes Save through the coordinator", async () => {
    const save = vi.fn(async () => ({ accepted: false as const, reason: "clean" as const }));
    const { handle, saveCoordinator } = renderEditor(opened(), { coordinator: coordinator({ save }) });
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    expect(handle.open).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("xlsx-cell-Data-C1")).toHaveTextContent("=SUM(A1:B1)");
    expect(screen.getByTestId("xlsx-name-box")).toHaveValue("C1");

    fireEvent.click(screen.getByRole("button", { name: "Làm lại" }));
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(handle.redo).toHaveBeenCalledTimes(1);
    expect(handle.undo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("xlsx-save"));
    expect(save).toHaveBeenCalledWith("button");
    expect(saveCoordinator).not.toHaveProperty("writeBytes");
  });

  it("mounts through the shared EditorSlot loader contract", async () => {
    const handle = editor();
    const host = {} as OfficeHost;
    const saveCoordinator = coordinator();
    const loadEditor = createXlsxEditorLoader({
      documentKey: "doc-v1",
      open: { open: vi.fn(async () => opened()) },
      coordinator: saveCoordinator,
    });
    render(<EditorSlot format="xlsx" host={host} capability="available" openState="ready" editorHandle={handle} loadEditor={loadEditor} />);
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    expect(handle.open).toHaveBeenCalledTimes(1);
  });

  it("keeps formula text as a formula through the G2 edit operation and Ctrl+S", async () => {
    const handle = editor();
    const save = vi.fn(async () => ({ accepted: false as const, reason: "clean" as const }));
    renderEditor(opened(), { editor: handle, coordinator: coordinator({ save }) });
    await waitFor(() => expect(screen.getByTestId("xlsx-formula-bar")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("xlsx-name-box")).toHaveValue("C1"));
    const formula = screen.getByTestId("xlsx-formula-bar");
    fireEvent.change(formula, { target: { value: "=A1+B1" } });
    fireEvent.keyDown(formula, { key: "Enter" });
    expect(handle.edit).toHaveBeenCalledWith([{ op: "set_cell", target: { sheet: "Data", cell: "C1" }, attributes: { formula: "=A1+B1" } }]);
    fireEvent.keyDown(formula, { key: "s", ctrlKey: true });
    expect(save).toHaveBeenCalledWith("shortcut");
    expect(formula).toHaveValue("=A1+B1");
  });

  it("shows formula-bar hints and completes a function name with Tab", async () => {
    const handle = editor();
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("xlsx-formula-bar")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("xlsx-name-box")).toHaveValue("C1"));
    const formula = screen.getByTestId("xlsx-formula-bar");
    fireEvent.change(formula, { target: { value: "=SU" } });
    expect(await screen.findByTestId("xlsx-formula-hints")).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-formula-hint-SUM")).toBeInTheDocument();
    fireEvent.keyDown(formula, { key: "Tab" });
    expect(formula).toHaveValue("=SUM(");
    expect(formula).toHaveFocus();
    expect(screen.queryByTestId("xlsx-formula-hints")).not.toBeInTheDocument();
    fireEvent.keyDown(formula, { key: "Enter" });
    expect(handle.edit).toHaveBeenLastCalledWith([
      { op: "set_cell", target: { sheet: "Data", cell: "C1" }, attributes: { formula: "=SUM(" } },
    ]);
  });

  it("closes the formula-bar hints with Escape without committing", async () => {
    const handle = editor();
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("xlsx-name-box")).toHaveValue("C1"));
    const formula = screen.getByTestId("xlsx-formula-bar");
    fireEvent.change(formula, { target: { value: "=AVE" } });
    expect(await screen.findByTestId("xlsx-formula-hints")).toBeInTheDocument();
    fireEvent.keyDown(formula, { key: "Escape" });
    expect(screen.queryByTestId("xlsx-formula-hints")).not.toBeInTheDocument();
    expect(formula).toHaveValue("=AVE");
    expect(handle.edit).not.toHaveBeenCalled();
  });

  it("sends numeric formula-bar input as a scalar value", async () => {
    const handle = editor();
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("xlsx-formula-bar")).toBeInTheDocument());
    const formula = screen.getByTestId("xlsx-formula-bar");
    fireEvent.click(screen.getByTestId("xlsx-cell-Data-A1"));
    fireEvent.change(formula, { target: { value: "2000000000" } });
    fireEvent.keyDown(formula, { key: "Enter" });
    expect(handle.edit).toHaveBeenLastCalledWith([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 2000000000 } }]);
  });

  it("routes cell selection and sheet focus through the host selection port", async () => {
    const handle = editor();
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("xlsx-cell-Data-A1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("xlsx-cell-Data-A1"));
    expect(handle.selection?.setSelection).toHaveBeenCalledWith({ sheet: "Data", address: "A1" });
    expect(screen.getByTestId("xlsx-name-box")).toHaveValue("A1");
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    expect(handle.selection?.setSelection).toHaveBeenLastCalledWith({ sheet: "Summary", address: "A1" });
    const formula = screen.getByTestId("xlsx-formula-bar");
    fireEvent.change(formula, { target: { value: "hello" } });
    fireEvent.keyDown(formula, { key: "Enter" });
    expect(handle.edit).toHaveBeenLastCalledWith([{ op: "set_cell", target: { sheet: "Summary", cell: "A1" }, attributes: { value: "hello" } }]);
  });

  it("reopens a failed attempt without disposing or cancelling the live handle", async () => {
    const handle = editor();
    const open = vi.fn()
      .mockResolvedValueOnce({ outcome: "failed", document_id: "doc", format: "xlsx", failure_class: "corrupted", message: "broken" } satisfies XlsxOpenOutcome)
      .mockResolvedValueOnce(opened());
    renderEditor({ outcome: "failed", document_id: "doc", format: "xlsx", failure_class: "corrupted", message: "broken" }, { editor: handle, open });
    await waitFor(() => expect(screen.getByTestId("xlsx-error-state")).toBeInTheDocument());
    const retryButton = screen.getByRole("alert").querySelector("button");
    expect(retryButton).not.toBeNull();
    fireEvent.click(retryButton!);
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(2);
    expect(handle.cancel).not.toHaveBeenCalled();
    expect(handle.dispose).not.toHaveBeenCalled();
  });

  it("keeps the live session when unrelated props change", async () => {
    const handle = editor();
    const open = vi.fn(async () => opened());
    const { view } = renderEditor(opened(), { editor: handle, open });
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    view.rerender(<XlsxEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={coordinator()} title="Renamed" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Renamed" })).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(1);
    expect(handle.cancel).not.toHaveBeenCalled();
    expect(handle.dispose).not.toHaveBeenCalled();
  });

  it("renders used cells outside the initial viewport window", async () => {
    const largeWorkbook: XlsxWorkbookSnapshot = {
      revision: 1,
      sheets: [{ id: "sheet-1", name: "Data", cells: {
        A1: { value: 1 },
        A25: { value: 25 },
        N1: { value: 14 },
      } }],
    };
    const handle = editor({ getWorkbookSnapshot: () => largeWorkbook });
    renderEditor({ outcome: "opened", document_id: "doc", document_model_ref: "model", snapshot: largeWorkbook }, { editor: handle });
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    expect(screen.getByTestId("xlsx-cell-Data-A25")).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-cell-Data-N1")).toBeInTheDocument();
  });

  it("marks results fresh only after a successful G2 recalc", async () => {
    const run = vi.fn(async (_signal: AbortSignal, onProgress?: (progress: number) => void) => {
      onProgress?.(100);
      return { cells: [], cached: false };
    });
    const handle = editor({ recalculate: { run } });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("xlsx-toolbar")).toBeInTheDocument());
    fireEvent.click(ribbonTab("formulas"));
    fireEvent.click(screen.getByRole("button", { name: "Tính lại công thức" }));
    await waitFor(() => expect(screen.getByText("Đã làm mới kết quả công thức.")).toBeInTheDocument());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("shows recalc progress, cancels it, and keeps the edited model without saving", async () => {
    let resolveRun: (() => void) | undefined;
    const run = vi.fn((_signal: AbortSignal, onProgress?: (progress: number) => void) => {
      onProgress?.(35);
      return new Promise<void>((resolve) => { resolveRun = resolve; });
    });
    const handle = editor({ recalculate: { run, cancel: vi.fn() } });
    const save = vi.fn(async () => ({ accepted: false as const, reason: "clean" as const }));
    renderEditor(opened(), { editor: handle, coordinator: coordinator({ save }) });
    await waitFor(() => expect(screen.getByTestId("xlsx-toolbar")).toBeInTheDocument());
    fireEvent.click(ribbonTab("formulas"));
    fireEvent.click(screen.getByRole("button", { name: "Tính lại công thức" }));
    await waitFor(() => expect(screen.getByTestId("xlsx-recalc-progress")).toBeInTheDocument());
    expect(screen.getByTestId("xlsx-recalc-progress")).toHaveTextContent("35%");
    fireEvent.click(screen.getByTestId("xlsx-recalc-cancel"));
    expect(handle.recalculate?.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("xlsx-recalc-error")).toHaveTextContent("Đã hủy");
    expect(save).not.toHaveBeenCalled();
    resolveRun?.();
  });

  it("does not mark a failed recalc fresh or save stale values", async () => {
    const run = vi.fn(async () => { throw new Error("engine timeout"); });
    const handle = editor({ recalculate: { run } });
    const save = vi.fn(async () => ({ accepted: false as const, reason: "clean" as const }));
    renderEditor(opened(), { editor: handle, coordinator: coordinator({ save }) });
    await waitFor(() => expect(screen.getByTestId("xlsx-toolbar")).toBeInTheDocument());
    fireEvent.click(ribbonTab("formulas"));
    fireEvent.click(screen.getByRole("button", { name: "Tính lại công thức" }));
    await waitFor(() => expect(screen.getByTestId("xlsx-recalc-error")).toHaveTextContent("engine timeout"));
    expect(screen.queryByText("Đã làm mới kết quả công thức.")).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps renderer internals out of the translated accessible error", async () => {
    renderEditor({ outcome: "failed", document_id: "doc", format: "xlsx", failure_class: "engine_error", message: "[redi]: Expect 1 dependency item(s)", engine_error: "SheetInterceptorService" });
    await waitFor(() => expect(screen.getByTestId("xlsx-error-state")).toBeInTheDocument());
    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveTextContent("redi");
    expect(alert).not.toHaveTextContent("engine_error");
    expect(alert).not.toHaveTextContent("SheetInterceptorService");
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it.each([
    ["not_office_file", "Tệp đã chọn"],
    ["corrupted", "Gói sổ tính"],
    ["unsupported_feature", "Tính năng XLSX"],
  ])("renders a typed %s error without a blank grid or Save", async (failureClass, message) => {
    renderEditor({ outcome: "failed", document_id: "doc", format: "xlsx", failure_class: failureClass, message });
    await waitFor(() => expect(screen.getByTestId("xlsx-error-state")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByTestId("xlsx-workbook-surface")).not.toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-save")).not.toBeInTheDocument();
  });

  it("opens the next valid file after a failed open without reloading the app", async () => {
    const open = vi.fn().mockResolvedValueOnce({ outcome: "failed", document_id: "bad", format: "xlsx", failure_class: "corrupted", message: "hỏng" } satisfies XlsxOpenOutcome).mockResolvedValueOnce(opened("good"));
    const handle = editor();
    const { view } = renderEditor({ outcome: "failed", document_id: "bad", format: "xlsx", failure_class: "corrupted", message: "hỏng" }, { open, editor: handle });
    await waitFor(() => expect(screen.getByTestId("xlsx-error-state")).toBeInTheDocument());
    view.rerender(<XlsxEditor documentKey="good" editor={handle} open={{ open }} coordinator={coordinator()} />);
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(2);
    expect(handle.open).toHaveBeenCalledTimes(1);
  });

  it("cancels and disposes an in-flight session", async () => {
    let resolveOpen: ((outcome: XlsxOpenOutcome) => void) | undefined;
    const open = vi.fn(() => new Promise<XlsxOpenOutcome>((resolve) => { resolveOpen = resolve; }));
    const handle = editor();
    const { view } = renderEditor(opened(), { open, editor: handle });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    view.unmount();
    await waitFor(() => expect(handle.cancel).toHaveBeenCalledWith("document_changed"));
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(resolveOpen).toBeDefined();
  });

  it("mounts the selection status bar under the workbook surface in both modes", async () => {
    const { view } = renderEditor(opened());
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    expect(screen.getByTestId("xlsx-status-bar")).toBeInTheDocument();
    // F2: the live snapshot feeds the summary, so a missing renderer host is no longer "unavailable".
    await waitFor(() => expect(screen.queryByTestId("xlsx-status-bar-unavailable")).not.toBeInTheDocument());
    view.rerender(<XlsxEditor documentKey="doc-v1" editor={editor()} open={{ open: async () => opened() }} coordinator={coordinator()} embedded />);
    await waitFor(() => expect(screen.getByTestId("xlsx-workbook-surface")).toBeInTheDocument());
    expect(screen.getByTestId("xlsx-status-bar")).toBeInTheDocument();
  });
});
