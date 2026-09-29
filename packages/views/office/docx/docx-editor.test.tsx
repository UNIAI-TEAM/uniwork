import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocxEditor } from "./docx-editor";
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

function renderEditor(outcome: DocxOpenOutcome, options?: { key?: string; open?: () => Promise<DocxOpenOutcome>; coordinator?: DocxSaveCoordinator }) {
  const handle = editor();
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

describe("DocxEditor", () => {
  it("mounts the host handle, exposes selection and routes Save through the coordinator", async () => {
    const save = vi.fn(async () => ({ accepted: false as const, reason: "clean" as const }));
    const { handle, saveCoordinator } = renderEditor(opened(), { coordinator: coordinator({ save }) });

    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    expect(handle.open).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("docx-selection")).toHaveTextContent("Vùng chọn 2–7");

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

  it("fails closed when the serialize capability is absent or unavailable", async () => {
    const handle = editor();
    const open = vi.fn(async () => opened());
    render(<DocxEditor documentKey="doc-v1" editor={handle} open={{ open }} coordinator={coordinator()} />);
    await waitFor(() => expect(screen.getByTestId("docx-error-state")).toBeInTheDocument());
    expect(open).not.toHaveBeenCalled();
    expect(handle.open).not.toHaveBeenCalled();
    expect(screen.queryByTestId("docx-save")).not.toBeInTheDocument();
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
});
