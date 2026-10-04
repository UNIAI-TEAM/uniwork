import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlEditor } from "./editor";
import { MarkdownEditor } from "../markdown/editor";
import type { HtmlEditorHandle, HtmlOpenOutcome } from "./types";
import type { MarkdownEditorHandle, MarkdownOpenOutcome } from "../markdown/types";
import type { IsolatedPreviewPort } from "../source-editor-types";

initI18n();
beforeEach(async () => { await setLocale("en"); });

function makeCoordinator() {
  const state = { state: "dirty" as const, dirtyGeneration: 1, lastSavedGeneration: 0, identity: { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v", baseRevision: "1" }, activeIntentId: null, error: null };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    markDirty: vi.fn(),
    checkpoint: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

function cmView(container: HTMLElement): EditorView {
  const dom = container.querySelector(".cm-editor");
  if (!dom) throw new Error("no cm-editor");
  const found = EditorView.findFromDOM(dom as HTMLElement);
  if (!found) throw new Error("no EditorView");
  return found;
}

function renderHtml(preview?: IsolatedPreviewPort) {
  let source = "<!doctype html>\n<!-- preserve -->\n<section data-x=\"1\">Keep</section>";
  const editor: HtmlEditorHandle = {
    format: "html",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { source } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    source: { getText: () => source, setText: (next) => { source = next; } },
    getAssetManifest: () => ({ entries: [{ path: "assets/site.css", assetId: "asset-css" }] }),
  };
  const outcome: HtmlOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
  const coordinator = makeCoordinator();
  const rendered = render(<HtmlEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} preview={preview} />);
  return { editor, coordinator, ...rendered };
}

describe("HtmlEditor", () => {
  it("preserves source while mounting an injected preview and routes Save", async () => {
    const mount = vi.fn(async ({ text }: { text: string }) => {
      expect(text).toContain("<!-- preserve -->");
      return { dispose: vi.fn(), update: vi.fn() };
    });
    const { editor, coordinator, container } = renderHtml({ mount });
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(cmView(container).state.doc.toString()).toContain("data-x=\"1\"");
    fireEvent.click(screen.getByTestId("html-save"));
    expect(coordinator.save).toHaveBeenCalledWith("button");
    expect(editor.dispose).not.toHaveBeenCalled();
  });

  it("renders the CodeMirror source and not the textarea for HTML", async () => {
    renderHtml();
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    expect(screen.queryByTestId("html-source")).toBeNull();
  });

  it("still renders the textarea for Markdown", async () => {
    let text = "# Keep";
    const editor: MarkdownEditorHandle = {
      format: "md",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 1,
      captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { text } })),
      undo: vi.fn(),
      redo: vi.fn(),
      dispose: vi.fn(),
      cancel: vi.fn(),
      source: { getText: () => text, setText: (next) => { text = next; } },
      getAssetManifest: () => ({ entries: [] }),
    };
    const outcome: MarkdownOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
    render(<MarkdownEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={makeCoordinator()} capability={{ format: "md", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    await waitFor(() => expect(screen.getByTestId("md-source")).toBeInTheDocument());
    expect(screen.queryByTestId("html-codemirror")).toBeNull();
  });

  it("shows an unavailable preview without an injected runtime", async () => {
    renderHtml();
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Preview unavailable")).toBeInTheDocument());
  });

  it("does not checkpoint during HTML IME composition and cancels and disposes on unmount", async () => {
    const { editor, coordinator, container, unmount } = renderHtml();
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    const view = cmView(container);
    fireEvent.compositionStart(view.contentDOM);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "draft" } });
    expect(coordinator.checkpoint).not.toHaveBeenCalled();
    fireEvent.compositionEnd(view.contentDOM);
    expect(coordinator.checkpoint).toHaveBeenCalledTimes(1);
    unmount();
    expect(editor.cancel).toHaveBeenCalledWith("document_changed");
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(coordinator.cancel).toHaveBeenCalledTimes(1);
  });
});
