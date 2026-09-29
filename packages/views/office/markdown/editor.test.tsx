import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./editor";
import type { MarkdownEditorHandle, MarkdownOpenOutcome, MarkdownSaveCoordinator } from "./types";
import type { IsolatedPreviewPort, PreviewMountOptions } from "../source-editor-types";

initI18n();
beforeEach(async () => { await setLocale("en"); });

function coordinator() {
  const state = { state: "dirty" as const, dirtyGeneration: 1, lastSavedGeneration: 0, identity: { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v", baseRevision: "1" }, activeIntentId: null, error: null };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    markDirty: vi.fn(),
    checkpoint: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  } satisfies MarkdownSaveCoordinator;
}

function renderEditor(options: { preview?: IsolatedPreviewPort; coordinator?: ReturnType<typeof coordinator>; permissions?: { canCopy?: boolean; canPaste?: boolean }; assetFailures?: Readonly<Record<string, "ready" | "missing" | "unauthorised" | "failed" | boolean>> } = {}) {
  let text = "---\ntitle: Keep\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n<!-- keep -->";
  const handle: MarkdownEditorHandle = {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 2,
    captureSnapshot: vi.fn(async () => ({ generation: 2, fingerprint: "fp", value: { text } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    source: { getText: () => text, setText: (next) => { text = next; } },
    clipboard: { writeText: vi.fn(async () => undefined), readText: vi.fn(async () => "pasted") },
    getAssetManifest: () => ({ entries: [{ key: "assets/logo.png", asset_id: "asset-logo" }] }),
  };
  const outcome: MarkdownOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
  const saveCoordinator = options.coordinator ?? coordinator();
  const preview = options.preview;
  const rendered = render(<MarkdownEditor documentKey="doc" editor={handle} open={{ open: vi.fn(async () => outcome) }} coordinator={saveCoordinator} capability={{ format: "md", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} permissions={options.permissions} assetFailures={options.assetFailures} preview={preview} />);
  return { handle, saveCoordinator, ...rendered };
}

describe("MarkdownEditor", () => {
  it("opens source, routes save through coordinator, and disposes/cancels", async () => {
    const { handle, saveCoordinator } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-source")).toBeInTheDocument());
    expect(screen.getByTestId("md-source").textContent ?? (screen.getByTestId("md-source") as HTMLTextAreaElement).value).toContain("title: Keep");
    fireEvent.click(screen.getByTestId("md-save"));
    expect(saveCoordinator.save).toHaveBeenCalledWith("button");
    fireEvent.keyDown(screen.getByTestId("md-editor"), { key: "s", ctrlKey: true });
    expect(saveCoordinator.save).toHaveBeenCalledWith("shortcut");
    expect(saveCoordinator).not.toHaveProperty("writeBytes");
  });

  it("does not checkpoint during IME composition and reports unavailable without a preview port", async () => {
    const { saveCoordinator } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-source")).toBeInTheDocument());
    const source = screen.getByTestId("md-source");
    fireEvent.compositionStart(source);
    fireEvent.change(source, { target: { value: "draft" } });
    expect(saveCoordinator.checkpoint).not.toHaveBeenCalled();
    fireEvent.compositionEnd(source);
    expect(saveCoordinator.checkpoint).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  });

  it("mounts the injected preview and never mutates source for the preview call", async () => {
    const update = vi.fn();
    const mount: IsolatedPreviewPort["mount"] = vi.fn(async ({ text: previewText }: PreviewMountOptions) => {
      expect(previewText).toContain("<!-- keep -->");
      return { update, dispose: vi.fn() };
    });
    renderEditor({ preview: { mount } });
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId("md-source") as HTMLTextAreaElement).value).toContain("<!-- keep -->");
  });

  it("updates a preview session with edits made while the initial mount is pending", async () => {
    type PendingSession = { update(text: string, manifest?: unknown): void; dispose(): void };
    let resolveMount!: (session: PendingSession) => void;
    const update = vi.fn();
    const dispose = vi.fn();
    const mount = vi.fn(() => new Promise<PendingSession>((resolve) => { resolveMount = resolve; }));
    renderEditor({ preview: { mount } });
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId("md-source"), { target: { value: "edited while mounting" } });
    resolveMount({ update, dispose });
    await waitFor(() => expect(update).toHaveBeenCalledWith("edited while mounting", expect.anything()));
  });

  it("routes clipboard through the handle and respects denied permissions", async () => {
    const { handle, unmount } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-source")).toBeInTheDocument());
    const source = screen.getByTestId("md-source") as HTMLTextAreaElement;
    source.focus();
    source.setSelectionRange(0, 4);
    fireEvent.keyDown(source, { key: "c", ctrlKey: true });
    expect(handle.clipboard?.writeText).toHaveBeenCalledWith("---\n");
    unmount();
    expect(handle.cancel).toHaveBeenCalledWith("document_changed");
    expect(handle.dispose).toHaveBeenCalled();

    const denied = renderEditor({ permissions: { canCopy: false, canPaste: false } });
    await waitFor(() => expect(screen.getByTestId("md-source")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Paste" })).toBeDisabled();
    denied.unmount();
  });

  it("routes undo and redo to the engine and keeps source unchanged for the app save shortcut", async () => {
    const { handle } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-source")).toBeInTheDocument());
    const source = screen.getByTestId("md-source") as HTMLTextAreaElement;
    const before = source.value;
    vi.mocked(handle.undo!).mockImplementation(() => { handle.source?.setText("undo result"); });
    vi.mocked(handle.redo!).mockImplementation(() => { handle.source?.setText(before); });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(source.value).toBe("undo result");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(handle.undo).toHaveBeenCalledTimes(1);
    expect(handle.redo).toHaveBeenCalledTimes(1);
    expect(source.value).toBe(before);
    fireEvent.keyDown(screen.getByTestId("md-editor"), { key: "s", ctrlKey: true });
    expect(source.value).toBe(before);
  });

  it("blocks Save when the host reports a failed asset", async () => {
    const { saveCoordinator } = renderEditor({ assetFailures: { "assets/bad.png": "failed" } });
    await waitFor(() => expect(screen.getByTestId("md-source")).toBeInTheDocument());
    expect(screen.getByTestId("md-save")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("This document cannot be saved until every asset is available.");
    fireEvent.click(screen.getByTestId("md-save"));
    expect(saveCoordinator.save).not.toHaveBeenCalled();
  });
});
