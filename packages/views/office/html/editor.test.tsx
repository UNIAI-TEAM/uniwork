import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlEditor } from "./editor";
import { MarkdownEditor } from "../markdown/editor";
import type { HtmlEditorHandle, HtmlOpenOutcome } from "./types";
import type { MarkdownEditorHandle, MarkdownOpenOutcome } from "../markdown/types";
import type { IsolatedPreviewPort, PreviewMountOptions } from "../source-editor-types";

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

const SOURCE = "<!doctype html>\n<!-- preserve -->\n<section data-x=\"1\">Keep</section>";

function renderHtml(preview?: IsolatedPreviewPort, permissions?: { canCopy?: boolean; canPaste?: boolean }) {
  let source = SOURCE;
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
  const rendered = render(<HtmlEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} preview={preview} permissions={permissions} />);
  return { editor, coordinator, ...rendered };
}

/** The editor landmark owns the mode shortcut, so keys land on the section. */
function pressCycle(container: HTMLElement) {
  fireEvent.keyDown(container.querySelector('[data-testid="html-editor"]')!, { key: "\\", ctrlKey: true });
}

async function renderReady(preview?: IsolatedPreviewPort) {
  const rendered = renderHtml(preview);
  await waitFor(() => expect(screen.getByTestId("html-shell")).toBeInTheDocument());
  return rendered;
}

describe("HtmlEditor", () => {
  it("preserves source while mounting an injected preview and routes Save", async () => {
    const mount = vi.fn(async ({ text }: { text: string }) => {
      expect(text).toContain("<!-- preserve -->");
      return { dispose: vi.fn(), update: vi.fn() };
    });
    const { editor, coordinator, container } = await renderReady({ mount });
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(cmView(container).state.doc.toString()).toContain("data-x=\"1\"");
    fireEvent.click(screen.getByTestId("html-save"));
    expect(coordinator.save).toHaveBeenCalledWith("button");
    expect(editor.dispose).not.toHaveBeenCalled();
  });

  it("renders the CodeMirror source and not the textarea for HTML", async () => {
    await renderReady();
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
    await renderReady();
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Preview unavailable")).toBeInTheDocument());
  });

  it("does not checkpoint during HTML IME composition and cancels and disposes on unmount", async () => {
    const { editor, coordinator, container, unmount } = await renderReady();
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

  it("routes one Ctrl+Z to exactly one undo on the shared snapshot stack", async () => {
    const { editor, container } = await renderReady();
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    const view = cmView(container);
    // CodeMirror owns no history in this pane, so the keydown bubbles to the
    // section handler, which is the SINGLE undo owner. If CM still bound
    // Mod-z, the keydown would also undo the doc in-pane and the section would
    // run a second undo: this asserts exactly one.
    fireEvent.keyDown(view.contentDOM, { key: "z", ctrlKey: true });
    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(editor.redo).not.toHaveBeenCalled();
    fireEvent.keyDown(view.contentDOM, { key: "y", ctrlKey: true });
    expect(editor.redo).toHaveBeenCalledTimes(1);
    expect(editor.undo).toHaveBeenCalledTimes(1);
  });

  it("blocks Ctrl+C/V on the HTML path when the permission is denied", async () => {
    renderHtml(undefined, { canCopy: false, canPaste: false });
    await waitFor(() => expect(screen.getByTestId("html-shell")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    const view = cmView(document.body);
    // The pane returns early for html so CodeMirror owns the native clipboard,
    // but a denied permission must still cancel the gesture.
    expect(fireEvent.keyDown(view.contentDOM, { key: "c", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(view.contentDOM, { key: "v", ctrlKey: true })).toBe(false);
  });

  it("leaves Copy/Paste to CodeMirror and keeps Save on the surface", async () => {
    await renderReady();
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    // The ribbon owns undo/redo; the shell must not draw dead Copy/Paste buttons.
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Paste" })).toBeNull();
    expect(screen.getByTestId("html-save")).toBeInTheDocument();
  });

  it("mounts the HTML ribbon so the surface has real chrome (RB-1)", async () => {
    await renderReady();
    // The regression this pins is the M4 F-01 trap: the ribbon was defined,
    // exported and unit-tested, but no production file rendered it, so the
    // demo HTML surface had no ribbon. Assert the real mount by its hook.
    const ribbon = document.querySelector<HTMLElement>('[data-office-ribbon="html"]');
    expect(ribbon).not.toBeNull();
    // Undo/redo ride the ribbon's quick access; the Source | Split | Preview |
    // Present control rides its trailing slot.
    expect(ribbon!.querySelector("[data-ribbon-quick-access]")).not.toBeNull();
    expect(ribbon!.querySelector("[data-ribbon-trailing]")).not.toBeNull();
    expect(ribbon!.querySelector('[data-ribbon-tab="home"]')).not.toBeNull();
  });
});

describe("HtmlEditor view modes", () => {
  it("defaults to split: the source pane and the preview pane are both present", async () => {
    await renderReady();
    expect(screen.getByTestId("html-shell")).toHaveAttribute("data-html-view", "split");
    expect(screen.getByTestId("html-codemirror")).toBeInTheDocument();
    expect(screen.getByTestId("html-preview")).toBeInTheDocument();
  });

  it("cycles source -> split -> preview -> present -> source on Ctrl+\\", async () => {
    const { container } = await renderReady();
    const view = () => screen.getByTestId("html-shell").getAttribute("data-html-view");
    expect(view()).toBe("split");
    pressCycle(container);
    expect(view()).toBe("preview");
    pressCycle(container);
    expect(view()).toBe("present");
    pressCycle(container);
    expect(view()).toBe("source");
    pressCycle(container);
    expect(view()).toBe("split");
  });

  it("renders only the panes each mode asks for", async () => {
    const { container } = await renderReady();
    // split -> preview: the source pane goes away.
    pressCycle(container);
    expect(screen.queryByTestId("html-codemirror")).toBeNull();
    expect(screen.getByTestId("html-preview")).toBeInTheDocument();
    // preview -> present: the preview stays, fullscreen and dialog-labelled.
    pressCycle(container);
    expect(screen.getByTestId("html-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("html-codemirror")).toBeNull();
    expect(screen.getByTestId("html-shell")).toHaveAttribute("role", "dialog");
    // present -> source: the preview goes away, the source returns.
    pressCycle(container);
    expect(screen.getByTestId("html-codemirror")).toBeInTheDocument();
    expect(screen.queryByTestId("html-preview")).toBeNull();
  });

  it("exits present mode on Escape", async () => {
    const { container } = await renderReady();
    pressCycle(container);
    pressCycle(container);
    expect(screen.getByTestId("html-shell")).toHaveAttribute("data-html-view", "present");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("html-shell")).toHaveAttribute("data-html-view", "preview");
  });

  it("mounts the preview through the injected port in every preview mode", async () => {
    const mount = vi.fn(async (_options: PreviewMountOptions) => ({ dispose: vi.fn(), update: vi.fn() }));
    const { container } = await renderReady({ mount });
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(mount.mock.calls[0]?.[0]).toMatchObject({ format: "html" });
    expect(mount.mock.calls[0]?.[0].text).toContain("<!-- preserve -->");
    // present keeps the same isolated port; it never asks for a script capability.
    pressCycle(container);
    pressCycle(container);
    expect(screen.getByTestId("html-shell")).toHaveAttribute("data-html-view", "present");
    expect(screen.getByTestId("html-preview")).toBeInTheDocument();
    expect(mount.mock.calls.every((call) => call[0].format === "html")).toBe(true);
  });
});

describe("HtmlEditor zoom and status bar", () => {
  it("shows the zoom value and changes it with − / + / reset", async () => {
    await renderReady();
    expect(screen.getByTestId("html-zoom-value")).toHaveTextContent("100");
    fireEvent.click(screen.getByTestId("html-zoom-in"));
    expect(screen.getByTestId("html-zoom-value")).toHaveTextContent("110");
    expect(screen.getByTestId("html-preview-scroll")).toHaveAttribute("data-html-zoom", "110");
    fireEvent.click(screen.getByTestId("html-zoom-out"));
    expect(screen.getByTestId("html-zoom-value")).toHaveTextContent("100");
    fireEvent.click(screen.getByTestId("html-zoom-in"));
    fireEvent.click(screen.getByTestId("html-zoom-reset"));
    expect(screen.getByTestId("html-zoom-value")).toHaveTextContent("100");
  });

  it("keeps the zoom controls in the status bar, not a chrome row of their own (C10)", async () => {
    await renderReady();
    // F1: the − / + / reset ladder is the right cluster of the status bar. The
    // dedicated `html-shell-toolbar` row is gone for every mode, so the chrome
    // height does not grow a row the layout does not define.
    expect(screen.queryByTestId("html-shell-toolbar")).toBeNull();
    expect(screen.getByTestId("html-status")).toContainElement(screen.getByTestId("html-zoom"));
  });

  it("shows the source length / line count and the zoom in the status bar", async () => {
    await renderReady();
    const figures = screen.getByTestId("html-status-figures");
    // The source has three lines; the status bar carries the raw length and line
    // count as data attributes (the copy is a MISSING i18n key until S5 lands it).
    expect(figures).toHaveAttribute("data-html-length", String(SOURCE.length));
    expect(figures).toHaveAttribute("data-html-lines", "3");
    expect(figures).toHaveAttribute("data-html-language", "HTML");
    expect(screen.getByTestId("html-status")).toContainElement(screen.getByTestId("html-zoom-value"));
    expect(screen.getByTestId("html-zoom-value")).toHaveTextContent("100");
  });
});
