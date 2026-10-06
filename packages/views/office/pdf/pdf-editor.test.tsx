import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OfficeHost } from "@uniwork/core/office";
import { setLocale } from "@uniwork/core/i18n";
import { EditorSlot } from "../editor-slot";
import { PdfEditor } from "./pdf-editor";
import { createPdfEditorLoader } from "./pdf-editor-slot";
import type { OfficeSaveReceipt, SaveAttemptResult } from "@uniwork/core/office";
import type { PdfEditorHandle, PdfOpenOutcome, PdfSaveCoordinator } from "./types";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import type { PdfCanvasPage } from "./canvas";

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

/** A minimal accepted receipt so the fake Save can report `accepted: true`. */
const receipt = (): OfficeSaveReceipt => ({
  intentId: "intent-1", idempotencyKey: "key-1", documentId: "doc", versionId: "version-2", revision: "2",
  checksumSha256: "sha-256", sizeBytes: 1, engineName: "engine", engineVersion: "1", contractVersion: "c1", protocolVersion: "p1",
});

/** A handle whose byte swap lands in a later microtask, like the web adapter's
    queued `step()`: `undo`/`redo` return void and only the `subscribe` notify
    carries the new generation. `Save` mirrors the coordinator's equality gate. */
function lateSwapSetup() {
  let generation = 0;
  let dirtyGeneration = 0;
  const listeners = new Set<() => void>();
  let swap: (() => void) | null = null;
  const outcomes: string[] = [];
  const handle = editor({
    getDirtyGeneration: () => generation,
    captureSnapshot: vi.fn(async () => ({ generation, fingerprint: `fp-${generation}`, value: { pages: [{ pageNumber: 1, rotation: 0 }], pageCount: 1 } })),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    undo: vi.fn(() => { swap = () => { generation += 1; for (const listener of [...listeners]) listener(); }; }),
    redo: vi.fn(() => { swap = () => { generation += 1; for (const listener of [...listeners]) listener(); }; }),
  });
  const save = vi.fn(async (): Promise<SaveAttemptResult> => {
    const snapshot = await handle.captureSnapshot();
    if (snapshot.generation !== dirtyGeneration) { outcomes.push("invalid_snapshot"); return { accepted: false, reason: "invalid_snapshot" }; }
    outcomes.push("accepted");
    return { accepted: true, intentId: "intent-1", receipt: receipt() };
  });
  const saveCoordinator = coordinator({ save, markDirty: (next: number) => { dirtyGeneration = Math.max(dirtyGeneration, next); } });
  return { handle, save, saveCoordinator, outcomes, mark: (value: number) => { dirtyGeneration = value; }, runSwap: () => swap?.(), generation: () => generation, dirty: () => dirtyGeneration };
}
const capability = { format: "pdf" as const, operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };

function renderEditor(outcome: PdfOpenOutcome = opened(), options?: { editor?: PdfEditorHandle; open?: () => Promise<PdfOpenOutcome>; coordinator?: PdfSaveCoordinator; key?: string }) {
  const handle = options?.editor ?? editor();
  const saveCoordinator = options?.coordinator ?? coordinator();
  const open = options?.open ?? vi.fn(async () => outcome);
  render(<PdfEditor documentKey={options?.key ?? "doc-v1"} editor={handle} open={{ open }} coordinator={saveCoordinator} capability={capability} />);
  return { handle, saveCoordinator, open };
}

describe("PdfEditor", () => {
  it("renders no header or title of its own - the host page owns the one header", async () => {
    render(<PdfEditor documentKey="doc" title="Bao cao.pdf" editor={editor()} open={{ open: vi.fn(async () => opened()) }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    const root = screen.getByTestId("pdf-editor");
    expect(root).toHaveAttribute("aria-label", "Bao cao.pdf");
    expect(root.querySelector("header")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-open-state")).not.toBeInTheDocument();
  });

  it("mounts the shared Office frame as the only ready-state chrome (F1, F2, F9, F10)", async () => {
    renderEditor(opened());
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    const frame = screen.getByTestId("pdf-canvas");
    expect(frame).toHaveAttribute("data-office-frame");
    // Ribbon first, status bar last, thumbnails in the rail beside the canvas.
    expect(frame.firstElementChild).toContainElement(screen.getByTestId("pdf-ribbon-bar"));
    expect(frame.lastElementChild).toHaveAttribute("data-testid", "pdf-status-bar");
    expect(frame.lastElementChild?.querySelector("[data-office-status-bar]")).not.toBeNull();
    expect(frame.querySelector("[data-office-canvas]")?.parentElement?.parentElement).toContainElement(screen.getByTestId("pdf-thumbnails-rail"));
    expect(frame).toContainElement(frame.querySelector("[data-office-canvas] [data-testid='pdf-document-surface']") as HTMLElement);
    expect(frame.querySelectorAll("[data-office-status-bar]")).toHaveLength(1);
    expect(screen.getByTestId("pdf-editor").textContent ?? "").not.toMatch(/office\.[a-z]+\./);
  });

  it("mounts the handle, submits text edits, undo/redo, and routes Save via coordinator", async () => {
    const save = vi.fn(async () => ({ accepted: false as const, reason: "clean" as const }));
    const handle = editor({ selection: { getSelection: () => ({ page: 1, objectId: "text-1", kind: "text" as const }), subscribe: () => () => undefined } });
    const saveCoordinator = coordinator({ save }) as PdfSaveCoordinator & { writeBytes: ReturnType<typeof vi.fn> };
    saveCoordinator.writeBytes = vi.fn();
    renderEditor(opened(), { editor: handle, coordinator: saveCoordinator });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    expect(screen.getByTestId("pdf-ribbon-bar")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-status-bar")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Chữ thay thế"), { target: { value: "Nội dung mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    expect(handle.edit).toHaveBeenCalledWith([{ op: "replace_text", target: { page: 1, objectId: "text-1" }, text: "Nội dung mới" }]);
    // Undo/redo and Save moved off the deleted toolbar onto the editor's keyboard handler.
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "z", ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "y", ctrlKey: true });
    expect(handle.undo).toHaveBeenCalledTimes(1);
    expect(handle.redo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "s", ctrlKey: true });
    expect(save).toHaveBeenNthCalledWith(1, "shortcut");
    expect(saveCoordinator.writeBytes).not.toHaveBeenCalled();
  });

  it("leaves Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z to editable controls and still undoes from the canvas", async () => {
    const handle = editor();
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    const root = screen.getByTestId("pdf-editor");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    root.append(textarea, select, editable, textbox);
    for (const target of [textarea, select, editable, textbox]) {
      expect(fireEvent.keyDown(target, { key: "z", ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: "y", ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: "z", ctrlKey: true, shiftKey: true })).toBe(true);
    }
    expect(handle.undo).not.toHaveBeenCalled();
    expect(handle.redo).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(screen.getByTestId("pdf-canvas"), { key: "z", ctrlKey: true })).toBe(false);
    expect(handle.undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId("pdf-canvas"), { key: "z", ctrlKey: true, shiftKey: true });
    expect(handle.redo).toHaveBeenCalledTimes(1);
  });

  it("selects pages and submits every page operation through the edit envelope", async () => {
    const handle = editor();
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Trang 2" }));
    expect(handle.selection?.setSelection).toHaveBeenCalledWith({ page: 2, objectId: null, kind: "page" });
    expect(screen.getByTestId("pdf-status-page")).toHaveTextContent("Trang 2");

    // Page commands moved from the deleted toolbar into the ribbon's pages tab.
    fireEvent.click(screen.getByTestId("pdf-chrome-tab-pages"));
    expect(screen.getByTestId("pdf-chrome-command-row")).toBeInTheDocument();
    // Rotate acts on the selected page at once; delete and reorder open the page strip.
    fireEvent.click(screen.getByRole("button", { name: "Xoay trang" }));
    expect(handle.edit).toHaveBeenCalledWith([{ op: "rotate_page", target: { page: 2 }, degrees: 90 }]);
    expect(handle.edit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("pdf-pages-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa trang" }));
    expect(screen.getByTestId("pdf-pages-panel")).toBeInTheDocument();
  });

  it("submits image replacement as an asset reference without decoding bytes", async () => {
    const handle = editor({ selection: { getSelection: () => ({ page: 2, objectId: "image-1", kind: "image" as const }), subscribe: () => () => undefined } });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Mã tài sản của provider"), { target: { value: "asset-42" } });
    // The ribbon's Home tab carries a "Thay ảnh" command too; apply from the object row.
    fireEvent.click(within(screen.getByTestId("pdf-object-editor")).getByRole("button", { name: "Thay ảnh" }));
    expect(handle.edit).toHaveBeenCalledWith([{ op: "replace_image", target: { page: 2, objectId: "image-1" }, assetId: "asset-42" }]);
  });

  it("keeps the open session when the UI locale changes", async () => {
    const handle = editor();
    const open = vi.fn(async () => opened());
    renderEditor(opened(), { editor: handle, open });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    await setLocale("en");
    await setLocale("vi");
    expect(open).toHaveBeenCalledTimes(1);
    expect(handle.dispose).not.toHaveBeenCalled();
  });

  it("surfaces a localized alert when an edit envelope is rejected", async () => {
    const handle = editor({ edit: vi.fn(async () => { throw new EngineBoundaryError("engine_incompatible"); }) });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Chữ thay thế"), { target: { value: "Nội dung mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Không thể áp dụng thay đổi PDF"));
  });

  it("mounts through the shared EditorSlot loader and handles a missing editor handle", async () => {
    const host = {} as OfficeHost;
    const saveCoordinator = coordinator();
    const loadEditor = createPdfEditorLoader({
      documentKey: "doc-v1",
      open: { open: vi.fn(async () => opened()) },
      coordinator: saveCoordinator,
      capability,
    });
    const handle = editor();
    render(<EditorSlot format="pdf" host={host} capability="available" openState="ready" editorHandle={handle} loadEditor={loadEditor} />);
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    expect(handle.open).toHaveBeenCalledTimes(1);
    const second = render(<EditorSlot format="pdf" host={host} capability="available" openState="ready" editorHandle={null} loadEditor={loadEditor} />);
    await waitFor(() => expect(second.getByTestId("pdf-error-state")).toBeInTheDocument());
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
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "s", ctrlKey: true });
    fireEvent.change(input, { target: { value: "second edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(handle.edit).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "s", ctrlKey: true });
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
    expect(screen.queryByTestId("pdf-ribbon-bar")).not.toBeInTheDocument();
  });

  it("localizes thrown engine failures and never exposes an internal exception message", async () => {
    const open = vi.fn(async () => { throw new EngineBoundaryError("engine_incompatible"); });
    render(<PdfEditor documentKey="doc" editor={editor()} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Không mở được PDF này");
    expect(screen.getByRole("alert")).not.toHaveTextContent("undefined");
    expect(screen.queryByTestId("pdf-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-ribbon-bar")).not.toBeInTheDocument();
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

  it("prompts for the password instead of the error state when the open needs one", async () => {
    const open = vi.fn(async (): Promise<PdfOpenOutcome> => ({ outcome: "failed", document_id: "doc", format: "pdf", failure_class: "password_required" }));
    render(<PdfEditor documentKey="doc" editor={editor()} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument());
    expect(screen.queryByTestId("pdf-error-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-canvas")).not.toBeInTheDocument();
  });

  it("does not mount the password prompt for a non-password failure", async () => {
    const open = vi.fn(async (): Promise<PdfOpenOutcome> => ({ outcome: "failed", document_id: "doc", format: "pdf", failure_class: "corrupted", message: "hỏng" }));
    render(<PdfEditor documentKey="doc" editor={editor()} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument());
    expect(screen.queryByTestId("pdf-password-prompt")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mật khẩu")).not.toBeInTheDocument();
  });

  it("opens with the typed password and keeps the session alive on submit", async () => {
    const open = vi.fn()
      .mockResolvedValueOnce({ outcome: "failed", document_id: "doc", format: "pdf", failure_class: "password_required" } satisfies PdfOpenOutcome)
      .mockResolvedValueOnce(opened());
    const handle = editor();
    const local = vi.spyOn(Storage.prototype, "setItem");
    render(<PdfEditor documentKey="doc" editor={handle} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "    " } });
    fireEvent.click(screen.getByRole("button", { name: "Mở tài liệu" }));
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    expect(open).toHaveBeenNthCalledWith(2, expect.any(AbortSignal), "    ");
    expect(handle.dispose).not.toHaveBeenCalled();
    expect(handle.open).toHaveBeenCalledTimes(1);
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it("re-prompts in wrong mode when the engine refuses the password", async () => {
    const open = vi.fn()
      .mockResolvedValueOnce({ outcome: "failed", document_id: "doc", format: "pdf", failure_class: "password_required" } satisfies PdfOpenOutcome)
      .mockResolvedValueOnce({ outcome: "failed", document_id: "doc", format: "pdf", failure_class: "wrong_password" } satisfies PdfOpenOutcome);
    render(<PdfEditor documentKey="doc" editor={editor()} open={{ open }} coordinator={coordinator()} capability={capability} />);
    await waitFor(() => expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "sai" } });
    fireEvent.click(screen.getByRole("button", { name: "Mở tài liệu" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Mật khẩu không mở được tài liệu này. Thử lại."));
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByTestId("pdf-error-state")).not.toBeInTheDocument();
  });

  it("reports password_cancelled and shows the error state when the prompt is dismissed", async () => {
    const open = vi.fn(async (): Promise<PdfOpenOutcome> => ({ outcome: "failed", document_id: "doc", format: "pdf", failure_class: "password_required" }));
    const onOpen = vi.fn();
    render(<PdfEditor documentKey="doc" editor={editor()} open={{ open }} coordinator={coordinator()} capability={capability} onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Bạn đã hủy hộp thoại mật khẩu.");
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ failure_class: "password_cancelled" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  const browserRenderer = { renderPage: vi.fn(async () => ({ src: "", width: 0, height: 0 })) };

  it("disables edit-text, replace-image and the page-op commands on a browser handle and says why", async () => {
    const handle = editor({ renderer: browserRenderer });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());

    // The browser host rewrites no content streams, so Edit and Replace open a
    // panel that is then refused; the control must be disabled and honest.
    fireEvent.click(screen.getByTestId("pdf-chrome-tab-edit"));
    const editText = document.querySelector("[data-ribbon-item='edit-text']") as HTMLElement;
    const replaceImage = document.querySelector("[data-ribbon-item='replace-image']") as HTMLElement;
    expect(editText).toHaveAttribute("aria-disabled", "true");
    expect(replaceImage).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("pdf-browser-unsupported")).toHaveTextContent("Thay đổi này chưa dùng được trên trình duyệt.");
    fireEvent.click(editText);
    expect(screen.queryByTestId("pdf-editor-panels")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("pdf-chrome-tab-pages"));
    for (const id of ["insert-page", "extract-page", "merge-pages"]) {
      expect(document.querySelector(`[data-ribbon-item='${id}']`)).toHaveAttribute("aria-disabled", "true");
    }
    // The Pages banner names only the ops that are refused, not "this edit".
    expect(screen.getByTestId("pdf-browser-unsupported")).toHaveTextContent("Chèn, trích xuất và gộp trang chưa dùng được trên trình duyệt.");
    // Delete, rotate and reorder need no Buffer producer and stay usable.
    for (const id of ["delete-page", "rotate-page", "reorder-page"]) {
      expect(document.querySelector(`[data-ribbon-item='${id}']`)).not.toHaveAttribute("aria-disabled");
    }
  });

  it("keeps the annotate commands enabled on a browser handle", async () => {
    const handle = editor({ renderer: browserRenderer });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pdf-chrome-tab-annotate"));
    for (const id of ["annotations", "highlight", "note", "stamp", "forms"]) {
      expect(document.querySelector(`[data-ribbon-item='${id}']`)).not.toHaveAttribute("aria-disabled");
    }
    expect(screen.queryByTestId("pdf-browser-unsupported")).not.toBeInTheDocument();
  });

  it("keeps edit-text, replace-image and the page-op commands enabled on the desktop handle", async () => {
    // No in-process renderer: the desktop/Node lane has the Buffer producers and
    // content-stream rewrites, so nothing is browser-gated.
    const handle = editor();
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pdf-chrome-tab-edit"));
    for (const id of ["edit-text", "replace-image"]) {
      expect(document.querySelector(`[data-ribbon-item='${id}']`)).not.toHaveAttribute("aria-disabled");
    }
    fireEvent.click(screen.getByTestId("pdf-chrome-tab-pages"));
    for (const id of ["insert-page", "extract-page", "merge-pages"]) {
      expect(document.querySelector(`[data-ribbon-item='${id}']`)).not.toHaveAttribute("aria-disabled");
    }
    expect(screen.queryByTestId("pdf-browser-unsupported")).not.toBeInTheDocument();
  });

  it("accepts a Save pressed right after undo by re-marking the post-swap generation", async () => {
    const { handle, save, saveCoordinator, outcomes, runSwap, dirty } = lateSwapSetup();
    renderEditor(opened(), { editor: handle, coordinator: saveCoordinator });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "z", ctrlKey: true });
    // The adapter's queued swap lands after the synchronous markDirty(0), so the
    // notify is what must carry the post-step generation to the coordinator.
    runSwap();
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "s", ctrlKey: true });

    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(outcomes).toEqual(["accepted"]));
    expect(dirty()).toBe(1);
  });

  it("accepts a Save pressed right after redo by re-marking the post-swap generation", async () => {
    const { handle, save, saveCoordinator, outcomes, runSwap, dirty } = lateSwapSetup();
    renderEditor(opened(), { editor: handle, coordinator: saveCoordinator });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "y", ctrlKey: true });
    runSwap();
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "s", ctrlKey: true });

    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(outcomes).toEqual(["accepted"]));
    expect(dirty()).toBe(1);
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

  it("binds Ctrl+F to Find and toggles it closed on a second press", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    const root = screen.getByTestId("pdf-editor");

    // The browser's own find must not fire; the editor opens its Find bar.
    expect(fireEvent.keyDown(root, { key: "f", ctrlKey: true })).toBe(false);
    expect(screen.getByRole("search")).toBeInTheDocument();
    fireEvent.keyDown(root, { key: "f", ctrlKey: true });
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("takes focus on load so Ctrl+F right after opening reaches the editor, not the browser", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    const root = screen.getByTestId("pdf-editor");
    expect(document.activeElement).toBe(root);
    // The browser targets the focused element: that is the editor landmark now.
    expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: "f", ctrlKey: true })).toBe(false);
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("does not steal focus from a control that already holds it", async () => {
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    try {
      renderEditor();
      await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it("opens the thumbnail rail from the status bar below sm and closes it on a page pick", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    const rail = screen.getByTestId("pdf-thumbnails-rail");
    expect(rail).toHaveClass("hidden", "sm:flex");
    const toggle = screen.getByTestId("pdf-rail-toggle");
    expect(toggle).toHaveAccessibleName("Hiện ảnh thu nhỏ trang");
    fireEvent.click(toggle);
    expect(rail).toHaveClass("flex");
    expect(rail).not.toHaveClass("hidden");
    expect(toggle).toHaveAccessibleName("Ẩn ảnh thu nhỏ trang");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("pdf-thumbnail-1"));
    expect(rail).toHaveClass("hidden");
  });

  it("does not toggle Find on Ctrl+Shift+F - the shifted chord is out of scope", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    const root = screen.getByTestId("pdf-editor");

    // The shifted chord must not reach the Find toggle (nor preventDefault the
    // browser's own Ctrl+Shift+F), while the plain Ctrl+F still opens Find.
    fireEvent.keyDown(root, { key: "F", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    fireEvent.keyDown(root, { key: "f", ctrlKey: true });
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("disables undo and redo when the handle exposes no history facet", async () => {
    const markDirty = vi.fn();
    // The desktop lane mounts a handle without undo/redo, so a no-op step must
    // not mark the document dirty and enable a Save of identical bytes.
    const handle = editor({ undo: undefined, redo: undefined });
    renderEditor(opened(), { editor: handle, coordinator: coordinator({ markDirty }) });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());

    expect(screen.getByTestId("pdf-chrome-undo")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("pdf-chrome-redo")).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "z", ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "y", ctrlKey: true });
    expect(markDirty).not.toHaveBeenCalled();
  });

  // F-12: Fit width / Fit page must compute the zoom from the real canvas pane
  // and the page box, not reset to 100%. jsdom has no layout, so the pane is
  // stubbed on the canvas element the shell measures.
  function stubPane(width: number, height: number) {
    const pane = screen.getByTestId("pdf-canvas").querySelector("[data-office-canvas]") as HTMLElement;
    Object.defineProperty(pane, "clientWidth", { value: width, configurable: true });
    Object.defineProperty(pane, "clientHeight", { value: height, configurable: true });
    return pane;
  }

  function canvasPage(overrides: Partial<PdfCanvasPage> = {}): readonly PdfCanvasPage[] {
    return [{ pageNumber: 1, width: 595, height: 842, rotation: 0, ...overrides }];
  }

  function clickViewItem(id: string) {
    fireEvent.click(screen.getByTestId("pdf-chrome-tab-view"));
    fireEvent.click(document.querySelector(`[data-ribbon-item='${id}']`) as HTMLElement);
  }

  it("fits the page width to the measured pane instead of resetting to 100% (F-12)", async () => {
    const handle = editor({ renderer: browserRenderer, getCanvasPages: () => canvasPage() });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    stubPane(975, 575);

    // The r5 pane: (975 - 32) / 595 = 1.58, never 100%.
    clickViewItem("fit-width");
    expect(screen.getByTestId("pdf-status-zoom")).toHaveTextContent("158%");
  });

  it("fits the whole page so it no longer overflows the pane (F-12)", async () => {
    const handle = editor({ renderer: browserRenderer, getCanvasPages: () => canvasPage() });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    stubPane(975, 575);

    // min((975 - 32) / 595, (575 - 32) / 842) = 0.64, so the page height fits.
    clickViewItem("fit-page");
    expect(screen.getByTestId("pdf-status-zoom")).toHaveTextContent("64%");
  });

  it("fits a rotated page by its displayed box (F-12)", async () => {
    const handle = editor({ renderer: browserRenderer, getCanvasPages: () => canvasPage({ rotation: 90 }) });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    stubPane(900, 575);

    // A quarter-turn page displays 842 x 595: (900 - 32) / 842 = 1.03.
    clickViewItem("fit-width");
    expect(screen.getByTestId("pdf-status-zoom")).toHaveTextContent("103%");
  });

  it("keeps the current zoom when the pane cannot be measured yet (F-12)", async () => {
    const handle = editor({ renderer: browserRenderer, getCanvasPages: () => canvasPage() });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());

    // jsdom reports a zero-size pane: fit must not guess and must not reset.
    clickViewItem("zoom-in");
    expect(screen.getByTestId("pdf-status-zoom")).toHaveTextContent("110%");
    clickViewItem("fit-page");
    expect(screen.getByTestId("pdf-status-zoom")).toHaveTextContent("110%");
  });

  it("opens fit-width (capped at 100%) when the pane is narrower than the page (F-12, 390px)", async () => {
    const handle = editor({ renderer: browserRenderer, getCanvasPages: () => canvasPage() });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());

    // jsdom measures 0 at first paint; the pane becomes measurable on resize.
    stubPane(390, 575);
    fireEvent(window, new Event("resize"));
    // (390 - 32) / 595 = 0.60, so the 595pt page fits the phone pane.
    await waitFor(() => expect(screen.getByTestId("pdf-status-zoom")).toHaveTextContent("60%"));
  });

  it("keeps 100% on open when the pane is wider than the page (F-12)", async () => {
    const handle = editor({ renderer: browserRenderer, getCanvasPages: () => canvasPage() });
    renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());

    // A wide pane fits 1.58x; the initial zoom is capped at 100%, never grown.
    stubPane(1440, 900);
    fireEvent(window, new Event("resize"));
    expect(screen.getByTestId("pdf-status-zoom")).toHaveTextContent("100%");
  });
});
