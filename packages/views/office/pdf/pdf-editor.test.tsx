import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfEditor } from "./pdf-editor";
import type { PdfEditorHandle, PdfOpenOutcome, PdfSaveCoordinator } from "./types";
import { EngineBoundaryError } from "@uniwork/office-contracts";

function coordinator(overrides: Partial<PdfSaveCoordinator> = {}): PdfSaveCoordinator {
  const state = {
    state: "dirty" as const,
    identity: { deploymentId: "dep", accountId: "account", organizationId: "org", workspaceId: "workspace", documentId: "doc", generation: 1, baseVersionId: "version", baseRevision: "1" },
    dirtyGeneration: 1,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return { getState: () => state, subscribe: () => () => undefined, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })), markDirty: vi.fn(), ...overrides };
}

function editor(overrides: Partial<PdfEditorHandle> = {}): PdfEditorHandle {
  const pages = [{ pageNumber: 1, rotation: 0 }, { pageNumber: 2, rotation: 0 }];
  return {
    format: "pdf",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 2,
    captureSnapshot: vi.fn(async () => ({ generation: 2, fingerprint: "fp", value: { pages, pageCount: pages.length } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    edit: vi.fn(),
    getPdfSnapshot: () => ({ pages, pageCount: pages.length }),
    selection: {
      getSelection: () => ({ page: 1, objectId: "text-1", kind: "text" as const }),
      setSelection: vi.fn(),
      subscribe: () => () => undefined,
    },
    ...overrides,
  };
}

const opened = (): PdfOpenOutcome => ({ outcome: "opened", document_id: "doc", document_model_ref: "model-1", warnings: [] });
const capability = { format: "pdf" as const, operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };

function renderEditor(outcome: PdfOpenOutcome = opened(), options?: { editor?: PdfEditorHandle; open?: () => Promise<PdfOpenOutcome>; coordinator?: PdfSaveCoordinator; key?: string }) {
  const handle = options?.editor ?? editor();
  const saveCoordinator = options?.coordinator ?? coordinator();
  const open = options?.open ?? vi.fn(async () => outcome);
  render(<PdfEditor documentKey={options?.key ?? "doc-v1"} editor={handle} open={{ open }} coordinator={saveCoordinator} capability={capability} />);
  return { handle, saveCoordinator, open };
}

describe("PdfEditor", () => {
  it("mounts the handle, renders pages, submits text/image/page edits, undo/redo, and routes Save via coordinator", async () => {
    const save = vi.fn(async () => ({ accepted: false as const, reason: "clean" as const }));
    const handle = editor({ selection: { getSelection: () => ({ page: 1, objectId: "text-1", kind: "text" as const }), subscribe: () => () => undefined } });
    const saveCoordinator = coordinator({ save }) as PdfSaveCoordinator & { writeBytes: ReturnType<typeof vi.fn> };
    saveCoordinator.writeBytes = vi.fn();
    renderEditor(opened(), { editor: handle, coordinator: saveCoordinator });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    expect(screen.getByTestId("pdf-page-panel")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Chữ thay thế"), { target: { value: "Nội dung mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    expect(handle.edit).toHaveBeenCalledWith([{ op: "replace_text", target: { page: 1, objectId: "text-1" }, text: "Nội dung mới" }]);
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    fireEvent.click(screen.getByRole("button", { name: "Làm lại" }));
    expect(handle.undo).toHaveBeenCalledTimes(1);
    expect(handle.redo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("pdf-save"));
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "s", ctrlKey: true });
    expect(save).toHaveBeenNthCalledWith(1, "button");
    expect(save).toHaveBeenNthCalledWith(2, "shortcut");
    expect(saveCoordinator.writeBytes).not.toHaveBeenCalled();
  });

  it("selects pages and submits every page operation through the edit envelope", async () => {
    const handle = editor();
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Trang 2" }));
    expect(handle.selection?.setSelection).toHaveBeenCalledWith({ page: 2, objectId: null, kind: "page" });
    expect(screen.getByTestId("pdf-selection")).toHaveTextContent("Trang 2");

    fireEvent.click(screen.getByRole("button", { name: "Chèn trang" }));
    fireEvent.click(screen.getByRole("button", { name: "Xóa trang" }));
    fireEvent.click(screen.getByRole("button", { name: "Xoay trang" }));
    fireEvent.click(screen.getByRole("button", { name: "Sắp xếp lại trang" }));
    fireEvent.click(screen.getByRole("button", { name: "Tách trang" }));
    fireEvent.click(screen.getByRole("button", { name: "Gộp trang" }));
    expect(handle.edit).toHaveBeenCalledWith([{ op: "insert_page", target: { index: 2 } }]);
    expect(handle.edit).toHaveBeenCalledWith([{ op: "delete_page", target: { page: 2 } }]);
    expect(handle.edit).toHaveBeenCalledWith([{ op: "rotate_page", target: { page: 2 }, degrees: 90 }]);
    expect(handle.edit).toHaveBeenCalledWith([{ op: "reorder_page", target: { page: 2 }, index: 0 }]);
    expect(handle.edit).toHaveBeenCalledWith([{ op: "extract_page", target: { page: 2 } }]);
    expect(handle.edit).toHaveBeenCalledWith([{ op: "merge_pages", target: { pages: [1, 2] } }]);
    fireEvent.click(screen.getByRole("button", { name: "Đưa lên" }));
    fireEvent.click(screen.getByRole("button", { name: "Tách" }));
    expect(handle.edit).toHaveBeenCalledWith([{ op: "reorder_page", target: { page: 2 }, index: 0 }]);
    expect(handle.edit).toHaveBeenCalledWith([{ op: "extract_page", target: { page: 2 } }]);
  });

  it("submits image replacement as an asset reference without decoding bytes", async () => {
    const handle = editor({ selection: { getSelection: () => ({ page: 2, objectId: "image-1", kind: "image" as const }), subscribe: () => () => undefined } });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Mã tài sản của provider"), { target: { value: "asset-42" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Thay ảnh" })[1]!);
    expect(handle.edit).toHaveBeenCalledWith([{ op: "replace_image", target: { page: 2, objectId: "image-1" }, assetId: "asset-42" }]);
  });

  it("keeps the edited model for Save N and submits the next edit for Save N+1", async () => {
    const model = { edits: [] as unknown[] };
    const handle = editor({
      edit: vi.fn(async (operations) => { model.edits.push(...operations); }),
      captureSnapshot: vi.fn(async () => ({ generation: model.edits.length, fingerprint: `fp-${model.edits.length}`, value: { pages: [{ pageNumber: 1, rotation: 0 }], pageCount: 1, edits: [...model.edits] } })),
    });
    const submitted: unknown[] = [];
    const save = vi.fn(async () => { submitted.push((await handle.captureSnapshot()).value); return { accepted: false as const, reason: "clean" as const }; });
    renderEditor(opened(), { editor: handle, coordinator: coordinator({ save }) });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    const input = screen.getByLabelText("Chữ thay thế");
    fireEvent.change(input, { target: { value: "first edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(handle.edit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("pdf-save"));
    fireEvent.change(input, { target: { value: "second edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(handle.edit).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId("pdf-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect((submitted[0] as { edits: unknown[] }).edits).toHaveLength(1);
    expect((submitted[1] as { edits: unknown[] }).edits).toHaveLength(2);
  });

  it.each([
    ["corrupted", "PDF bị hỏng"],
    ["unsupported_feature", "Engine chưa hỗ trợ"],
    ["engine_error", "Engine PDF không thể mở tài liệu này."],
  ])("renders a typed %s error without a blank canvas or Save", async (failureClass, message) => {
    renderEditor({ outcome: "failed", document_id: "doc", format: "pdf", failure_class: failureClass as "corrupted" | "unsupported_feature", message });
    await waitFor(() => expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByTestId("pdf-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-save")).not.toBeInTheDocument();
  });

  it("localizes thrown engine failures and never exposes an internal exception message", async () => {
    const open = vi.fn(async () => { throw new EngineBoundaryError("engine_incompatible"); });
    render(<PdfEditor documentKey="doc" editor={editor()} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Không mở được PDF này");
    expect(screen.getByRole("alert")).not.toHaveTextContent("undefined");
    expect(screen.queryByTestId("pdf-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-save")).not.toBeInTheDocument();
  });

  it("localizes a generic thrown open failure instead of rendering its raw message", async () => {
    const open = vi.fn(async () => { throw new Error("socket exploded at C:/private/path"); });
    render(<PdfEditor documentKey="doc" editor={editor()} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Không mở được PDF này");
    expect(screen.getByRole("alert")).not.toHaveTextContent("C:/private/path");
  });

  it("surfaces missing embedded fonts and opens the next valid file without reloading", async () => {
    const open = vi.fn().mockResolvedValueOnce({ outcome: "failed", document_id: "bad", format: "pdf", failure_class: "corrupted", message: "hỏng" } satisfies PdfOpenOutcome).mockResolvedValueOnce(opened());
    const handle = editor({ getFontReport: () => ({ missing: ["Avenir"], embedded: [] }) });
    const view = render(<PdfEditor documentKey="bad" editor={handle} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument());
    view.rerender(<PdfEditor documentKey="good" editor={handle} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByTestId("pdf-font-warning")).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(2);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("cancels and disposes an in-flight session", async () => {
    let resolveOpen: ((outcome: PdfOpenOutcome) => void) | undefined;
    const open = vi.fn(() => new Promise<PdfOpenOutcome>((resolve) => { resolveOpen = resolve; }));
    const handle = editor();
    const view = render(<PdfEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    // Unmounting aborts the facade operation and disposes the G3-01 session.
    view.unmount();
    expect(resolveOpen).toBeDefined();
    expect(handle.cancel).toHaveBeenCalledWith("document_changed");
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });
});
