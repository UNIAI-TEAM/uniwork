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

function renderEditor(options: { preview?: IsolatedPreviewPort; coordinator?: ReturnType<typeof coordinator>; permissions?: { canCopy?: boolean; canPaste?: boolean } } = {}) {
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
  const rendered = render(<MarkdownEditor documentKey="doc" editor={handle} open={{ open: vi.fn(async () => outcome) }} coordinator={saveCoordinator} capability={{ format: "md", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} permissions={options.permissions} preview={preview} />);
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
});
