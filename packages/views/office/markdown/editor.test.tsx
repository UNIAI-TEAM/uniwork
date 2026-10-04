import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./editor";
import type { MarkdownEditorHandle, MarkdownOpenOutcome, MarkdownSaveCoordinator } from "./types";
import type { IsolatedPreviewPort, PreviewMountOptions, TextCapability } from "../source-editor-types";

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

const CAPABILITY: TextCapability & { format: "md" } = { format: "md", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] };

const FIXTURE = "---\ntitle: Keep\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n<!-- keep -->";

function renderEditor(options: { preview?: IsolatedPreviewPort; coordinator?: ReturnType<typeof coordinator>; permissions?: { canCopy?: boolean; canPaste?: boolean }; assetFailures?: Readonly<Record<string, "ready" | "missing" | "unauthorised" | "failed" | boolean>>; capability?: TextCapability & { format: "md" }; openFails?: boolean } = {}) {
  let text = FIXTURE;
  const listeners = new Set<(next: string) => void>();
  const handle: MarkdownEditorHandle = {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 2,
    captureSnapshot: vi.fn(async () => ({ generation: 2, fingerprint: "fp", value: { text } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    source: {
      getText: () => text,
      setText: (next) => { if (next === text) return; text = next; listeners.forEach((listener) => listener(next)); },
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    },
    clipboard: { writeText: vi.fn(async () => undefined), readText: vi.fn(async () => "pasted") },
    getAssetManifest: () => ({ entries: [{ key: "assets/logo.png", asset_id: "asset-logo" }] }),
  };
  const outcome: MarkdownOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
  const saveCoordinator = options.coordinator ?? coordinator();
  const open = vi.fn(async () => options.openFails ? ({ outcome: "failed", document_id: "doc", format: "md", failure_class: "engine_error", message: "boom" } as MarkdownOpenOutcome) : outcome);
  const rendered = render(<MarkdownEditor documentKey="doc" editor={handle} open={{ open }} coordinator={saveCoordinator} capability={options.capability ?? CAPABILITY} permissions={options.permissions} assetFailures={options.assetFailures} preview={options.preview} />);
  return { handle, saveCoordinator, open, ...rendered };
}

/** The ribbon's trailing Source | Visual control (C11). */
function switchToSource() {
  fireEvent.click(screen.getByText("Source"));
}

describe("MarkdownEditor (production surface)", () => {
  it("renders the WYSIWYG canvas by default, not the textarea", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.getByTestId("md-editor")).toHaveAttribute("data-md-view", "visual");
    expect(screen.queryByTestId("md-source")).toBeNull();
    // The visual canvas is a real ProseMirror surface driven by the shared source.
    await waitFor(() => expect(document.querySelector(".ProseMirror[contenteditable='true']")).toBeTruthy());
    expect(document.querySelector(".ProseMirror")!.textContent).toContain("const x = 1;");
  });

  it("still offers the source textarea through the ribbon Source | Visual toggle", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    switchToSource();
    await waitFor(() => expect(screen.getByTestId("md-source")).toBeInTheDocument());
    expect((screen.getByTestId("md-source") as HTMLTextAreaElement).value).toContain("title: Keep");
    expect(screen.queryByTestId("md-wysiwyg")).toBeNull();
  });

  it("routes Save through the coordinator from both entry points and disposes on unmount", async () => {
    const { handle, saveCoordinator, unmount } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("md-save"));
    expect(saveCoordinator.save).toHaveBeenCalledWith("button");
    fireEvent.keyDown(screen.getByTestId("md-editor"), { key: "s", ctrlKey: true });
    expect(saveCoordinator.save).toHaveBeenCalledWith("shortcut");
    expect(saveCoordinator).not.toHaveProperty("writeBytes");
    unmount();
    expect(handle.cancel).toHaveBeenCalledWith("document_changed");
    expect(handle.dispose).toHaveBeenCalled();
  });

  it("keeps the open handshake: a failed open renders the error state", async () => {
    const { open } = renderEditor({ openFails: true });
    await waitFor(() => expect(screen.getByTestId("md-error-state")).toBeInTheDocument());
    expect(screen.getByTestId("md-error-state")).toHaveTextContent("boom");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("gates editing on the capability: an unavailable build renders the error state", async () => {
    const onOpen = vi.fn();
    const handle = { format: "md", open: vi.fn(async () => undefined), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), source: { getText: () => "", setText: vi.fn() } } as unknown as MarkdownEditorHandle;
    render(<MarkdownEditor documentKey="doc" editor={handle} open={{ open: vi.fn() }} coordinator={coordinator()} capability={{ ...CAPABILITY, status: "unavailable" }} onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByTestId("md-error-state")).toBeInTheDocument());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  });

  it("keeps a read-only document unsavable", async () => {
    renderEditor({ capability: { ...CAPABILITY, status: "readonly" } });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.getByTestId("md-save")).toBeDisabled();
  });

  it("blocks Save when the host reports a failed asset", async () => {
    const { saveCoordinator } = renderEditor({ assetFailures: { "assets/bad.png": "failed" } });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.getByTestId("md-save")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("This document cannot be saved until every asset is available.");
    fireEvent.click(screen.getByTestId("md-save"));
    expect(saveCoordinator.save).not.toHaveBeenCalled();
  });
});

describe("MarkdownEditor source mode", () => {
  it("disables the ribbon commands while source mode is showing (no editor instance)", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    const bold = () => document.querySelector<HTMLElement>('[data-ribbon-item="bold"]')!;
    expect(bold()).not.toHaveAttribute("aria-disabled");
    switchToSource();
    await screen.findByTestId("md-source");
    expect(bold()).toHaveAttribute("aria-disabled", "true");
  });

  it("does not checkpoint during IME composition and reports unavailable without a preview port", async () => {
    const { saveCoordinator } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    switchToSource();
    const source = await screen.findByTestId("md-source");
    fireEvent.compositionStart(source);
    fireEvent.change(source, { target: { value: "draft" } });
    expect(saveCoordinator.checkpoint).not.toHaveBeenCalled();
    fireEvent.compositionEnd(source);
    expect(saveCoordinator.checkpoint).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  });

  it("mounts the injected preview in source mode and never mutates source for the preview call", async () => {
    const update = vi.fn();
    const mount: IsolatedPreviewPort["mount"] = vi.fn(async ({ text: previewText }: PreviewMountOptions) => {
      expect(previewText).toContain("<!-- keep -->");
      return { update, dispose: vi.fn() };
    });
    renderEditor({ preview: { mount } });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    switchToSource();
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
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    switchToSource();
    const source = await screen.findByTestId("md-source");
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    // Edit while `preview.mount` is still unresolved: the session does not exist
    // yet, so the post-mount `session.update(latestText)` is the only path that
    // can carry this text to the preview.
    fireEvent.change(source, { target: { value: "edited while mounting" } });
    resolveMount({ update, dispose });
    await waitFor(() => expect(update).toHaveBeenCalledWith("edited while mounting", expect.anything()));
  });

  it("routes clipboard through the handle and respects denied permissions", async () => {
    const { handle, unmount } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    switchToSource();
    const source = (await screen.findByTestId("md-source")) as HTMLTextAreaElement;
    source.focus();
    source.setSelectionRange(0, 4);
    fireEvent.keyDown(source, { key: "c", ctrlKey: true });
    expect(handle.clipboard?.writeText).toHaveBeenCalledWith("---\n");
    unmount();

    const denied = renderEditor({ permissions: { canCopy: false, canPaste: false } });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    switchToSource();
    await screen.findByTestId("md-source");
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Paste" })).toBeDisabled();
    denied.unmount();
  });

  it("routes undo and redo to the engine in source mode", async () => {
    const { handle } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    switchToSource();
    const source = (await screen.findByTestId("md-source")) as HTMLTextAreaElement;
    const before = source.value;
    vi.mocked(handle.undo!).mockImplementation(() => { handle.source?.setText("undo result"); });
    vi.mocked(handle.redo!).mockImplementation(() => { handle.source?.setText(before); });
    // The ribbon's quick access and the source toolbar both label undo/redo;
    // the source toolbar is the one wired to the snapshot stack here.
    const toolbar = within(screen.getByTestId("md-toolbar"));
    fireEvent.click(toolbar.getByRole("button", { name: "Undo" }));
    expect(source.value).toBe("undo result");
    fireEvent.click(toolbar.getByRole("button", { name: "Redo" }));
    expect(handle.undo).toHaveBeenCalledTimes(1);
    expect(handle.redo).toHaveBeenCalledTimes(1);
    expect(source.value).toBe(before);
  });
});
