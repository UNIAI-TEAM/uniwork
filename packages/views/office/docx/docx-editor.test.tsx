import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocxEditor } from "./docx-editor";
import { docxExtensions } from "./docx-schema";
import { createDocxCommandRuntime } from "./commands";
import type { DocxEditorHandle, DocxOpenFailure, DocxOpenOutcome, DocxSaveCoordinator } from "./types";

function coordinator(overrides: Partial<DocxSaveCoordinator> = {}): DocxSaveCoordinator {
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

function editor(): DocxEditorHandle {
  return {
    format: "docx",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 2,
    captureSnapshot: vi.fn(async () => ({ generation: 2, fingerprint: "fp", value: {} })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    selection: {
      getSelection: () => ({ blockId: "p1", from: 2, to: 7 }),
      subscribe: () => () => undefined,
    },
  };
}

const opened = (): DocxOpenOutcome => ({
  outcome: "opened",
  document_id: "doc",
  document_model_ref: "model-1",
  warnings: [],
});

function renderEditor(outcome: DocxOpenOutcome, options?: { key?: string; open?: () => Promise<DocxOpenOutcome>; coordinator?: DocxSaveCoordinator; editor?: DocxEditorHandle }) {
  const handle = options?.editor ?? editor();
  const saveCoordinator = options?.coordinator ?? coordinator();
  const open = options?.open ?? vi.fn(async () => outcome);
  render(
    <DocxEditor
      documentKey={options?.key ?? "doc-v1"}
      editor={handle}
      open={{ open }}
      coordinator={saveCoordinator}
      capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }}
    />,
  );
  return { handle, saveCoordinator, open };
}

const liveEditors: Editor[] = [];

afterEach(() => {
  for (const live of liveEditors.splice(0)) live.destroy();
});

describe("DocxEditor", () => {
  it("leaves document controls to the host while retaining the Save shortcut", async () => {
    const saveCoordinator = coordinator();
    render(<DocxEditor documentKey="doc" editor={editor()} open={{ open: async () => opened() }} coordinator={saveCoordinator} showDocumentControls={false} capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    expect(screen.queryByTestId("docx-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("docx-open-state")).not.toBeInTheDocument();
    expect(screen.getByTestId("docx-toolbar")).toBeInTheDocument();
    // One shared frame: ribbon inside it, status row last, help trigger in that row.
    const frame = document.querySelector("[data-office-frame]");
    expect(frame).not.toBeNull();
    expect(frame).toContainElement(screen.getByTestId("docx-toolbar"));
    expect(frame).toContainElement(screen.getByTestId("docx-canvas"));
    const statusRow = document.querySelector("[data-office-status-bar]");
    expect(frame?.lastElementChild).toBe(statusRow?.parentElement);
    expect(statusRow).toContainElement(screen.getByTestId("docx-shortcuts-help-trigger"));
    expect(screen.getByTestId("docx-shortcuts-help-trigger").className).not.toMatch(/absolute|fixed/);
    fireEvent.keyDown(screen.getByTestId("docx-editor"), { key: "s", ctrlKey: true });
    expect(saveCoordinator.save).toHaveBeenCalledWith("shortcut");
  });

  it("leaves a host-owned session alive during Strict Mode replay and unmount", async () => {
    const handle = editor();
    const saveCoordinator = coordinator();
    const open = { open: vi.fn(async () => opened()) };
    const view = render(<StrictMode><DocxEditor documentKey="doc" editor={handle} open={open} coordinator={saveCoordinator} manageSession={false} capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    expect(handle.dispose).not.toHaveBeenCalled();
    expect(handle.cancel).not.toHaveBeenCalled();
    view.unmount();
    expect(handle.dispose).not.toHaveBeenCalled();
  });

  it("marks the coordinator dirty immediately on an editor change", async () => {
    const handle = editor();
    const saveCoordinator = coordinator();
    let listener: ((generation: number) => void) | undefined;
    const unsubscribe = vi.fn();
    handle.subscribeDirty = (callback) => { listener = callback; return unsubscribe; };
    const view = render(<DocxEditor documentKey="doc" editor={handle} open={{ open: async () => opened() }} coordinator={saveCoordinator} capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    listener?.(7);
    expect(saveCoordinator.markDirty).toHaveBeenCalledWith(7);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("mounts the host handle, exposes selection and routes Save through the coordinator", async () => {
    const save = vi.fn(async () => ({ accepted: false as const, reason: "clean" as const }));
    const { handle, saveCoordinator } = renderEditor(opened(), { coordinator: coordinator({ save }) });

    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    expect(handle.open).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("docx-status-selection")).toHaveTextContent("Vùng chọn 2–7");

    fireEvent.click(screen.getByRole("button", { name: "Làm lại" }));
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(handle.redo).toHaveBeenCalledTimes(1);
    expect(handle.undo).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("docx-save"));
    expect(save).toHaveBeenCalledWith("button");
    fireEvent.keyDown(screen.getByTestId("docx-editor"), { key: "s", ctrlKey: true });
    expect(save).toHaveBeenCalledWith("shortcut");
    expect(saveCoordinator).not.toHaveProperty("writeBytes");
  });

  it.each([
    ["corrupted", "Gói DOCX bị hỏng"],
    ["password_cancelled", "Bạn đã hủy"],
    ["unsupported_feature", "Engine hiện tại"],
  ])("renders a typed %s error without a blank editor or Save", async (failureClass, message) => {
    renderEditor({
      outcome: "failed",
      document_id: "doc",
      format: "docx",
      failure_class: failureClass as DocxOpenFailure["failure_class"],
      message,
    });
    await waitFor(() => expect(screen.getByTestId("docx-error-state")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByTestId("docx-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("docx-save")).not.toBeInTheDocument();
  });

  it("opens the next valid file after a failed open without reloading the app", async () => {
    const open = vi.fn()
      .mockResolvedValueOnce({ outcome: "failed", document_id: "bad", format: "docx", failure_class: "corrupted", message: "hỏng" } satisfies DocxOpenOutcome)
      .mockResolvedValueOnce(opened());
    const handle = editor();
    const saveCoordinator = coordinator();
    const view = render(<DocxEditor documentKey="bad" editor={handle} open={{ open }} coordinator={saveCoordinator} capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    await waitFor(() => expect(screen.getByTestId("docx-error-state")).toBeInTheDocument());
    view.rerender(<DocxEditor documentKey="good" editor={handle} open={{ open }} coordinator={saveCoordinator} capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(2);
    expect(handle.open).toHaveBeenCalledTimes(1);
  });

  it("cancels and disposes an in-flight session", async () => {
    let resolveOpen: ((outcome: DocxOpenOutcome) => void) | undefined;
    const open = vi.fn(() => new Promise<DocxOpenOutcome>((resolve) => { resolveOpen = resolve; }));
    const handle = editor();
    const view = render(<DocxEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={coordinator()} capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(handle.cancel).toHaveBeenCalledWith("document_changed");
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(resolveOpen).toBeDefined();
  });

  it.each([
    ["absent", undefined],
    ["readonly", { status: "readonly" as const, operation: "serialize" }],
    ["unavailable", { status: "unavailable" as const, operation: "serialize" }],
    ["unknown", { status: "unknown" as const, operation: "serialize" }],
    ["non-serialize", { status: "available" as const, operation: "open" }],
  ])("fails closed for a %s capability row", async (_label, capabilityInput) => {
    const handle = editor();
    const open = vi.fn(async () => opened());
    const onOpen = vi.fn();
    const capability = capabilityInput
      ? {
          format: "docx" as const,
          operation: capabilityInput.operation,
          host: "browser",
          engineBuild: "test",
          contractRevision: "test",
          status: capabilityInput.status,
          fidelityWarnings: [],
        }
      : undefined;
    render(<DocxEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={coordinator()} capability={capability} onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByTestId("docx-error-state")).toBeInTheDocument());
    expect(open).not.toHaveBeenCalled();
    expect(handle.open).not.toHaveBeenCalled();
    expect(screen.queryByTestId("docx-save")).not.toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      document_id: "doc-v1",
      format: "docx",
      failure_class: "unsupported_feature",
    }));
  });

  it("does not expose a raw failure class token in the error state", async () => {
    renderEditor({
      outcome: "failed",
      document_id: "doc",
      format: "docx",
      failure_class: "wrong_password",
    });
    await waitFor(() => expect(screen.getByTestId("docx-error-state")).toBeInTheDocument());
    expect(screen.getByRole("alert")).not.toHaveTextContent("wrong_password");
  });

  it("starts opening when the serialize capability becomes available", async () => {
    const handle = editor();
    const open = vi.fn(async () => opened());
    const view = render(<DocxEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={coordinator()} />);
    await waitFor(() => expect(screen.getByTestId("docx-error-state")).toBeInTheDocument());
    expect(open).not.toHaveBeenCalled();

    view.rerender(<DocxEditor
      documentKey="doc-v1"
      editor={handle}
      open={{ open }}
      coordinator={coordinator()}
      capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }}
    />);
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(1);
    expect(handle.open).toHaveBeenCalledTimes(1);
  });

  it("closes an active session when serialize becomes readonly", async () => {
    const handle = editor();
    const open = vi.fn(async () => opened());
    const coordinatorInstance = coordinator();
    const available = { format: "docx" as const, operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };
    const view = render(<DocxEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={coordinatorInstance} capability={available} />);
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());

    view.rerender(<DocxEditor
      documentKey="doc-v1"
      editor={handle}
      open={{ open }}
      coordinator={coordinatorInstance}
      capability={{ ...available, status: "readonly" }}
    />);
    await waitFor(() => expect(screen.getByTestId("docx-error-state")).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(1);
    expect(handle.open).toHaveBeenCalledTimes(1);
    expect(handle.cancel).toHaveBeenCalledWith("document_changed");
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("docx-save")).not.toBeInTheDocument();
  });

  it("bounds the editor height and makes the canvas the scroller (M-5b)", async () => {
    renderEditor(opened());
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    const root = screen.getByTestId("docx-editor");
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("min-h-0");
    expect(root.className).toContain("overflow-hidden");
    const canvas = screen.getByTestId("docx-canvas");
    expect(canvas.className).toContain("min-h-0");
    expect(canvas.className).toContain("h-full");
    // The frame canvas is the scroll container and carries the Office grey.
    const frameCanvas = canvas.closest("[data-office-canvas]");
    expect(frameCanvas?.className).toContain("flex-1");
    expect(frameCanvas?.className).toContain("overflow-auto");
    expect(frameCanvas?.className).toContain("bg-office-canvas");
  });

  it("opens the context menu on right click over a live document surface (M-2)", async () => {
    const live = new Editor({
      extensions: docxExtensions(),
      content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text: "Body" }] }] },
    });
    liveEditors.push(live);
    const handle = editor();
    // The handle's command runtime drives the live editor; DocxEditor reads it from there.
    handle.commands = createDocxCommandRuntime(() => live);
    handle.renderSurface = () => <div data-testid="surface-child">Body</div>;
    render(
      <DocxEditor
        documentKey="doc"
        editor={handle}
        open={{ open: async () => opened() }}
        coordinator={coordinator()}
        capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId("surface-child"));
    expect(await screen.findByTestId("docx-context-menu")).toBeInTheDocument();
  });

  it("does not reopen when shell callback identities change", async () => {
    const handle = editor();
    const open = vi.fn(async () => opened());
    const saveCoordinator = coordinator();
    const capability = { format: "docx" as const, operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };
    const view = render(<DocxEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={saveCoordinator} capability={capability} onOpen={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    view.rerender(<DocxEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={saveCoordinator} capability={{ ...capability }} onOpen={() => undefined} />);
    expect(open).toHaveBeenCalledTimes(1);
    expect(handle.dispose).not.toHaveBeenCalled();
  });

  it("marks dirty only when an undo/redo step moved the document and keeps an empty history aria-disabled (UNI-954)", async () => {
    let generation = 2;
    let depth = 0;
    let emitSelection: ((next: { blockId: string; from: number; to: number } | null) => void) | null = null;
    const handle: DocxEditorHandle = {
      ...editor(),
      getDirtyGeneration: () => generation,
      canUndo: () => depth > 0,
      canRedo: () => false,
      // A selection change re-renders the shell, as a TipTap transaction does.
      selection: { getSelection: () => ({ blockId: "p1", from: 2, to: 7 }), subscribe: (listener) => { emitSelection = listener; return () => { emitSelection = null; }; } },
    };
    const { saveCoordinator } = renderEditor(opened(), { editor: handle });
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    const undo = screen.getByRole("button", { name: "Hoàn tác" });
    expect(undo).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Làm lại" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(undo);
    expect(handle.undo).not.toHaveBeenCalled();
    expect(saveCoordinator.markDirty).not.toHaveBeenCalled();
    // A handle that claims a step but does not move (an empty TipTap history)
    // still leaves the document clean.
    depth = 1;
    act(() => emitSelection?.({ blockId: "p1", from: 3, to: 3 }));
    expect(screen.getByRole("button", { name: "Hoàn tác" })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(handle.undo).toHaveBeenCalledTimes(1);
    expect(saveCoordinator.markDirty).not.toHaveBeenCalled();
    vi.mocked(handle.undo!).mockImplementation(() => { generation += 1; });
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(saveCoordinator.markDirty).toHaveBeenCalledWith(3);
  });
});
