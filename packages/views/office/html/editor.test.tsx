import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlEditor } from "./editor";
import { HtmlVisualShell } from "./visual/shell";
import { HeaderActionsSlot, HeaderActionsSlotProvider } from "../../layout/header-actions-slot";
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

function renderHtml(preview?: IsolatedPreviewPort, permissions?: { canCopy?: boolean; canPaste?: boolean }, title?: string) {
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
  const rendered = render(<HtmlEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} preview={preview} permissions={permissions} title={title} />);
  return { editor, coordinator, ...rendered };
}

/** The editor landmark owns the mode shortcut, so keys land on the section. */
function pressCycle(container: HTMLElement) {
  // `code`, not `key`: a layout where Ctrl+\ arrives as "|" still cycles (N3).
  fireEvent.keyDown(container.querySelector('[data-testid="html-editor"]')!, { key: "\\", code: "Backslash", ctrlKey: true });
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
    // F2: no per-surface Save button; the Ctrl+S handshake still routes to the
    // coordinator from the editor landmark.
    expect(screen.queryByTestId("html-save")).toBeNull();
    fireEvent.keyDown(container.querySelector('[data-testid="html-editor"]')!, { key: "s", ctrlKey: true });
    expect(coordinator.save).toHaveBeenCalledWith("shortcut");
    expect(editor.dispose).not.toHaveBeenCalled();
  });

  it("renders the CodeMirror source and not the textarea for HTML", async () => {
    await renderReady();
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    expect(screen.queryByTestId("html-source")).toBeNull();
  });

  it("renders the Markdown WYSIWYG surface (M-WIRE) and not CodeMirror", async () => {
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
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
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
    expect(screen.queryByTestId("html-save")).toBeNull();
  });

  it("grows the Source | Split | Preview segmented control to a 44px touch target (VFIXMINOR)", async () => {
    // Visual r1: at 390px the segmented items stayed 28px, under the 44px
    // coarse-pointer contract the primitives hold. ToggleGroupItem is not a
    // Button, so it does not inherit that contract; the ribbon must declare it.
    await renderReady();
    const group = screen.getByTestId("html-view-toggle");
    const items = Array.from(group.querySelectorAll<HTMLElement>("[data-slot='toggle-group-item']"));
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.className).toContain("pointer-coarse:min-h-11");
      expect(item.className).toContain("pointer-coarse:min-w-11");
    }
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

  it("cycles on Ctrl+Shift+\\ too, where the key arrives as | (N3)", async () => {
    const { container } = await renderReady();
    fireEvent.keyDown(container.querySelector('[data-testid="html-editor"]')!, { key: "|", code: "Backslash", ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId("html-shell")).toHaveAttribute("data-html-view", "preview");
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

  it("names the preview mount with the document title, not the generic label (F2)", async () => {
    const mount = vi.fn(async (_options: PreviewMountOptions) => ({ dispose: vi.fn(), update: vi.fn() }));
    renderHtml({ mount }, undefined, "Q3 report.html");
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    // The mount title becomes the isolated iframe's accessible name.
    expect(mount.mock.calls[0]?.[0].title).toBe("Q3 report.html");
  });

  it("falls back to the generic HTML label when the caller passes no title (F2)", async () => {
    const mount = vi.fn(async (_options: PreviewMountOptions) => ({ dispose: vi.fn(), update: vi.fn() }));
    await renderReady({ mount });
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(mount.mock.calls[0]?.[0].title).toBe("HTML document");
  });

  it("offers a visible exit in present and keeps one shell root, so the preview session survives (F3, F4)", async () => {
    const dispose = vi.fn();
    const mount = vi.fn(async (_options: PreviewMountOptions) => ({ dispose, update: vi.fn() }));
    const { container } = await renderReady({ mount });
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    const root = screen.getByTestId("html-shell");
    pressCycle(container); // split -> preview
    pressCycle(container); // preview -> present
    expect(screen.getByTestId("html-shell")).toHaveAttribute("data-html-view", "present");
    // F4: present toggles a class on the SAME root; the preview is never remounted.
    expect(screen.getByTestId("html-shell")).toBe(root);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    // F3: a discoverable exit the presenter can click when the iframe owns focus.
    fireEvent.click(screen.getByTestId("html-present-exit"));
    expect(screen.getByTestId("html-shell")).toHaveAttribute("data-html-view", "preview");
    expect(screen.getByTestId("html-shell")).toBe(root);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("moves one mode per Ctrl+\\ press from every mode, including Preview (VFIXMINOR)", async () => {
    // Visual r1: from Preview the first press did nothing and a second was
    // needed. The cause was focus: source -> preview unmounts the CodeMirror
    // pane that held focus, focus fell to <body>, and the next keydown never
    // reached the section handler. One press must move exactly one mode from
    // every mode, so the landmark takes focus back when its pane is gone.
    const { container } = await renderReady();
    await waitFor(() => expect(screen.getByTestId("html-codemirror")).toBeInTheDocument());
    const view = () => screen.getByTestId("html-shell").getAttribute("data-html-view");
    const section = container.querySelector('[data-testid="html-editor"]') as HTMLElement;
    // Start in the source pane, the realistic entry point (focus inside).
    container.querySelector<HTMLElement>(".cm-content")?.focus();
    expect(view()).toBe("split");
    // split -> preview: the source pane unmounts, taking focus with it.
    fireEvent.keyDown(document.activeElement ?? section, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(view()).toBe("preview");
    // Preview -> present must be ONE press; before the fix focus was on <body>
    // and this press was lost, so the mode stayed "preview".
    fireEvent.keyDown(document.activeElement ?? section, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(view()).toBe("present");
    fireEvent.keyDown(document.activeElement ?? section, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(view()).toBe("source");
    fireEvent.keyDown(document.activeElement ?? section, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(view()).toBe("split");
  });

  it("never draws an inner header, title or Save row (F1/F2)", async () => {
    // The page header cluster owns Save and the title; the surface mounts only
    // the shared frame, whether or not a header-actions slot exists above it.
    let source = SOURCE;
    const editor: HtmlEditorHandle = {
      format: "html", open: vi.fn(async () => undefined), getDirtyGeneration: () => 1,
      captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { source } })),
      undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), cancel: vi.fn(),
      source: { getText: () => source, setText: (next) => { source = next; } },
      getAssetManifest: () => ({ entries: [] }),
    };
    const outcome: HtmlOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
    render(
      <HeaderActionsSlotProvider>
        <HtmlEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={makeCoordinator()} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />
      </HeaderActionsSlotProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("html-shell")).toBeInTheDocument());
    expect(screen.queryByTestId("html-save")).toBeNull();
    expect(screen.queryByTestId("html-open-state")).toBeNull();
    expect(screen.queryByTestId("html-toolbar")).toBeNull();
    expect(document.querySelector("[data-testid='html-editor'] header")).toBeNull();
    expect(document.querySelector("[data-testid='html-editor'] h1")).toBeNull();
  });

  it("moves focus into present and restores it on exit (N2)", async () => {
    const { container } = await renderReady();
    const landmark = container.querySelector('[data-testid="html-editor"]') as HTMLElement;
    landmark.focus();
    expect(document.activeElement).toBe(landmark);
    pressCycle(container); // split -> preview
    pressCycle(container); // preview -> present
    expect(document.activeElement).toBe(screen.getByTestId("html-shell"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(landmark);
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

describe("HtmlVisualShell split panes at 390px (VFIXMINOR)", () => {
  it("stacks the panes below lg and lets the canvas scroll instead of clipping", () => {
    // Visual r1: at 390px the split view clipped. The canvas is overflow-hidden
    // and each pane keeps its own height, so a stacked pane must neither be
    // compressed to zero nor trapped; the canvas scrolls in the stacked layout
    // and only shares the row (overflow hidden) from lg up.
    render(
      <HtmlVisualShell
        documentKey="doc"
        text="<p>x</p>"
        viewMode="split"
        onViewModeChange={() => undefined}
        zoom={100}
      />,
    );
    const canvas = screen.getByTestId("html-canvas");
    expect(canvas.className).toContain("overflow-y-auto");
    expect(canvas.className).toContain("lg:overflow-hidden");
    expect(canvas.className).toContain("lg:flex-row");
    const source = screen.getByTestId("html-source-pane");
    const preview = screen.getByTestId("html-preview-scroll");
    for (const pane of [source, preview]) {
      expect(pane.className).toContain("min-w-0");
      expect(pane.className).toContain("min-h-64");
      expect(pane.className).toContain("lg:min-h-0");
      expect(pane.className).toContain("lg:flex-1");
    }
  });

  it("keeps the single-pane modes free to fill the canvas (no stacked floor)", () => {
    render(
      <HtmlVisualShell
        documentKey="doc"
        text="<p>x</p>"
        viewMode="preview"
        onViewModeChange={() => undefined}
        zoom={100}
      />,
    );
    const canvas = screen.getByTestId("html-canvas");
    expect(canvas.className).not.toContain("overflow-y-auto");
    expect(canvas.className).toContain("overflow-hidden");
  });
});

describe("HtmlVisualShell overlay contract (F5)", () => {
  it("renders the overlay inside a relative canvas so children self-position", () => {
    render(
      <HtmlVisualShell
        documentKey="doc"
        text="<p>x</p>"
        viewMode="preview"
        onViewModeChange={() => undefined}
        zoom={100}
        overlay={<span data-testid="probe-overlay" />}
      />,
    );
    const canvas = screen.getByTestId("html-canvas");
    expect(canvas.className).toContain("relative");
    expect(canvas).toContainElement(screen.getByTestId("probe-overlay"));
  });

  it("keeps the present exit inside the same relative canvas", async () => {
    const { container } = await renderReady();
    pressCycle(container); // split -> preview
    pressCycle(container); // preview -> present
    expect(screen.getByTestId("html-canvas")).toContainElement(screen.getByTestId("html-present-exit"));
  });
});

describe("HtmlEditor zoom and status bar", () => {
  it("shows the zoom value and changes it with the shared OfficeStatusZoom ladder", async () => {
    await renderReady();
    const zoomValue = () => screen.getByTestId("html-zoom").querySelector("[data-office-status-zoom]")!.textContent;
    expect(zoomValue()).toBe("100%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoomValue()).toBe("110%");
    expect(screen.getByTestId("html-preview-scroll")).toHaveAttribute("data-html-zoom", "110");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoomValue()).toBe("100%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: /Reset zoom/ }));
    expect(zoomValue()).toBe("100%");
  });

  it("keeps one shared status bar, with the zoom ladder in it (C10/F8)", async () => {
    await renderReady();
    // F1/F8: exactly one 28px OfficeStatusBar carries the figures and the zoom;
    // the local `html-shell-toolbar` row and the hand-rolled status row are gone.
    expect(screen.queryByTestId("html-shell-toolbar")).toBeNull();
    expect(document.querySelectorAll("[data-office-status-bar]")).toHaveLength(1);
    const status = document.querySelector("[data-office-status-bar]")!;
    expect(status.className).toContain("h-7");
    expect(status).toContainElement(screen.getByTestId("html-zoom"));
  });

  it("shows the source length / line count and the zoom in the status bar", async () => {
    await renderReady();
    const figures = screen.getByTestId("html-status-figures");
    // The source has three lines; the status bar carries the raw length and line
    // count as data attributes and renders the copy through the real keys.
    expect(figures).toHaveAttribute("data-html-length", String(SOURCE.length));
    expect(figures).toHaveAttribute("data-html-lines", "3");
    expect(figures).toHaveAttribute("data-html-language", "HTML");
    expect(figures).toHaveTextContent(`${SOURCE.length} chars`);
    expect(screen.getByTestId("html-status-selection")).toHaveTextContent("No selection");
    expect(document.querySelector("[data-office-status-bar]")).toContainElement(screen.getByTestId("html-zoom"));
  });

  it("splits the status bar: figures left, selection + zoom right (M1/C10)", async () => {
    await renderReady();
    const left = screen.getByTestId("html-status-left");
    const right = screen.getByTestId("html-status-right");
    // M1: figures stay in the LEFT cluster; the selection info and the zoom
    // ladder move to the RIGHT cluster, matching the DOCX example and C10, so
    // the ladder is not clipped by the left cluster's `truncate` flex.
    expect(left).toContainElement(screen.getByTestId("html-status-figures"));
    expect(left).not.toContainElement(screen.getByTestId("html-status-selection"));
    expect(left).not.toContainElement(screen.getByTestId("html-zoom"));
    expect(right).toContainElement(screen.getByTestId("html-status-selection"));
    expect(right).toContainElement(screen.getByTestId("html-zoom"));
    // The `end` cluster is the shared bar's trailing `shrink-0` flex, so the
    // zoom ladder is not inside the truncating `start` cluster.
    expect(document.querySelector("[data-office-status-bar]")).toContainElement(right);
  });
});

/**
 * UNI-928 F1/F2/F8: the HTML ready state is the shared Office frame, edge to
 * edge - one ribbon region, one 28px status bar with the shared zoom ladder,
 * no inner card and no per-surface Save.
 */
describe("HtmlEditor mounts the shared Office frame (F1/F2/F8)", () => {
  it("mounts OfficeFrame with the HTML ribbon, one status bar and no inner chrome", async () => {
    const { container } = await renderReady();
    const frame = container.querySelector<HTMLElement>("[data-office-frame]");
    expect(frame).not.toBeNull();
    expect(frame!.querySelector('[data-office-ribbon="html"]')).not.toBeNull();
    expect(frame!.querySelector("[data-office-canvas]")).not.toBeNull();
    expect(container.querySelectorAll("[data-office-status-bar]")).toHaveLength(1);
    expect(container.querySelector("[data-office-status-zoom]")).not.toBeNull();
    expect(screen.queryByTestId("html-save")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    const landmark = container.querySelector("[data-testid='html-editor']")!;
    expect(landmark.className).not.toMatch(/rounded-/);
    expect(landmark.className).not.toMatch(/border(\s|$)/);
  });

  it("puts the status bar in the frame's own slot, below the assets strip (F1)", async () => {
    const { container } = await renderReady();
    const frame = container.querySelector<HTMLElement>("[data-office-frame]")!;
    // Exactly one bar, and it is a DIRECT child of the frame - the frame's
    // `statusBar` slot, not a row drawn inside the canvas.
    const bars = container.querySelectorAll("[data-office-status-bar]");
    expect(bars).toHaveLength(1);
    expect(bars[0]!.parentElement).toBe(frame);
    expect(frame.querySelector("[data-office-canvas]")).not.toContainElement(bars[0] as HTMLElement);
    // Ordering (B2): when an asset band exists it paints ABOVE the status bar,
    // so the bar is the bottom-most row of the frame - never the other way
    // round.
    const assets = screen.getByTestId("html-assets");
    expect(assets.compareDocumentPosition(bars[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(frame.lastElementChild).toBe(bars[0]);
  });

  it("draws ONE status band: no empty asset row above it (M-2/F9)", async () => {
    // The visual END report saw an "asset-manifest-empty" row stacked above the
    // status row. With no manifest entries and no failures the aside must not
    // render at all, so the status bar is the only band under the canvas.
    let source = SOURCE;
    const editor: HtmlEditorHandle = {
      format: "html", open: vi.fn(async () => undefined), getDirtyGeneration: () => 1,
      captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { source } })),
      undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), cancel: vi.fn(),
      source: { getText: () => source, setText: (next) => { source = next; } },
      getAssetManifest: () => ({ entries: [] }),
    };
    const outcome: HtmlOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
    const { container } = render(<HtmlEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={makeCoordinator()} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    await waitFor(() => expect(screen.getByTestId("html-shell")).toBeInTheDocument());
    expect(screen.queryByTestId("html-assets")).toBeNull();
    expect(screen.queryByTestId("asset-manifest-empty")).toBeNull();
    const bars = container.querySelectorAll("[data-office-status-bar]");
    expect(bars).toHaveLength(1);
    // F9: with no strip above it the status row keeps its own separator, so
    // exactly one band is drawn and nothing changes from the default.
    expect((bars[0] as HTMLElement).className).not.toContain("border-t-0");
  });

  it("keeps the asset band when the manifest has rows (M-2/F9)", async () => {
    const { container } = await renderReady();
    // The default handle reports one manifest entry, so the band stays.
    const assets = screen.getByTestId("html-assets");
    const bars = container.querySelectorAll("[data-office-status-bar]");
    expect(bars).toHaveLength(1);
    expect(assets.compareDocumentPosition(bars[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // D-html/F9: the strip keeps the top separator and the joined status row
    // drops its own, so the two rows paint ONE band instead of two.
    expect((bars[0] as HTMLElement).className).toContain("border-t-0");
    expect(screen.queryByTestId("asset-manifest-empty")).toBeNull();
  });

  it("advances one mode per Ctrl+\\ from EVERY mode, including a double preview (M-7)", async () => {
    // The visual report: source -> split -> preview -> preview -> source, i.e.
    // a press was lost. A press must always step one mode, whatever holds
    // focus - inside the landmark, on <body>, or on the preview pane.
    const { container } = await renderReady();
    const view = () => screen.getByTestId("html-shell").getAttribute("data-html-view");
    const section = container.querySelector('[data-testid="html-editor"]') as HTMLElement;
    const press = (target: Element | Window | Document) => fireEvent.keyDown(target, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(view()).toBe("split");
    // Press with focus parked OUTSIDE the landmark (the preview iframe case).
    (document.activeElement as HTMLElement | null)?.blur();
    press(document.body);
    expect(view()).toBe("preview");
    // A second press with focus still outside must not be swallowed.
    press(document.body);
    expect(view()).toBe("present");
    press(document.body);
    expect(view()).toBe("source");
    press(section);
    expect(view()).toBe("split");
  });

  it("clears the draft offer after a successful save (M-8)", async () => {
    // Reloading within ~4 s of a successful save offered a stale draft. The
    // surface must not request a checkpoint for a generation the coordinator
    // already committed, so nothing recreates the cleared draft.
    let source = SOURCE;
    const editor: HtmlEditorHandle = {
      format: "html", open: vi.fn(async () => undefined), getDirtyGeneration: () => 1,
      captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { source } })),
      undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), cancel: vi.fn(),
      source: { getText: () => source, setText: (next) => { source = next; } },
      getAssetManifest: () => ({ entries: [{ path: "a.png", assetId: "asset-a" }] }),
    };
    // A coordinator whose last save already covers generation 1.
    let listener: ((state: ReturnType<typeof makeCoordinator>["getState"] extends () => infer S ? S : never) => void) | null = null;
    const base = makeCoordinator();
    const state = { ...base.getState(), state: "saved" as const, dirtyGeneration: 1, lastSavedGeneration: 1 };
    const coordinator = {
      ...base,
      getState: () => state,
      subscribe: (next: (value: typeof state) => void) => { listener = next as never; return () => { listener = null; }; },
    };
    const outcome: HtmlOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
    render(<HtmlEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    await waitFor(() => expect(screen.getByTestId("html-shell")).toBeInTheDocument());
    const section = document.querySelector('[data-testid="html-editor"]') as HTMLElement;
    // An undo at the saved generation must not mint a fresh draft checkpoint.
    fireEvent.keyDown(section, { key: "z", ctrlKey: true });
    expect(coordinator.checkpoint).not.toHaveBeenCalled();
  });

  it("offers a `?` help affordance that opens the shortcuts sheet (F8)", async () => {
    await renderReady();
    const trigger = screen.getByTestId("html-shortcuts-help-trigger");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    // The `?` is the last item of the shared bar (after the zoom ladder).
    const bar = document.querySelector("[data-office-status-bar]")!;
    expect(bar.lastElementChild?.lastElementChild).toBe(trigger);
    expect(screen.queryByTestId("html-shortcuts-dialog")).toBeNull();
    fireEvent.click(trigger);
    expect(await screen.findByTestId("html-shortcuts-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("html-shortcuts-list")).toBeInTheDocument();
  });

  it("suppresses the status bar while presenting (chrome-free)", async () => {
    const { container } = await renderReady();
    expect(container.querySelectorAll("[data-office-status-bar]")).toHaveLength(1);
    pressCycle(container); // split -> preview
    pressCycle(container); // preview -> present
    expect(screen.getByTestId("html-shell")).toHaveAttribute("data-html-view", "present");
    expect(container.querySelectorAll("[data-office-status-bar]")).toHaveLength(0);
  });

  it("keeps the open and error states rendering outside the frame", async () => {
    const editor: HtmlEditorHandle = {
      format: "html", open: vi.fn(async () => undefined), getDirtyGeneration: () => 1,
      captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { source: SOURCE } })),
      undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), cancel: vi.fn(),
      source: { getText: () => SOURCE, setText: () => undefined },
    };
    const outcome: HtmlOpenOutcome = { outcome: "failed", document_id: "doc", format: "html", failure_class: "engine_error", message: "boom" };
    const { container } = render(<HtmlEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={makeCoordinator()} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />);
    await waitFor(() => expect(screen.getByTestId("html-error-state")).toBeInTheDocument());
    expect(container.querySelector("[data-office-frame]")).toBeNull();
  });
});

/**
 * UNI-928: the HTML surface's Find affordance. The ribbon's trailing Find
 * button was never rendered because the host passed no `onFind`; the shared
 * `FindReplacePanel` (S4) now searches the HTML document's SOURCE string, the
 * one text the surface edits and saves.
 */
describe("HtmlEditor find (UNI-928)", () => {
  function pressCtrl(key: string) {
    fireEvent.keyDown(document, { key, ctrlKey: true });
  }

  it("opens on Ctrl+F find-only, counts matches, and closes on Escape", async () => {
    await renderReady();
    expect(screen.queryByTestId("html-find")).toBeNull();

    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    // Find-only: the replace row is not rendered (Ctrl+H adds it).
    expect(screen.queryByTestId("find-replace-value")).toBeNull();

    // The searched text is the document source: "section" opens and closes.
    fireEvent.change(screen.getByTestId("find-replace-query"), { target: { value: "section" } });
    await waitFor(() => expect(screen.getByTestId("find-replace-count")).toHaveTextContent("1/2"));

    fireEvent.keyDown(screen.getByTestId("find-replace-query"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("find-replace-panel")).toBeNull());
    expect(screen.queryByTestId("html-find")).toBeNull();
  });

  it("opens with the replace row on Ctrl+H and applies a replacement through the text port", async () => {
    const { editor } = await renderReady();
    pressCtrl("h");
    await waitFor(() => expect(screen.getByTestId("find-replace-value")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("find-replace-query"), { target: { value: "Keep" } });
    await waitFor(() => expect(screen.getByTestId("find-replace-count")).toHaveTextContent("1/1"));
    fireEvent.change(screen.getByTestId("find-replace-value"), { target: { value: "Gone" } });
    fireEvent.click(screen.getByTestId("find-replace-one"));

    // The write went through the shared handle, not a direct DOM write.
    await waitFor(() => expect(editor.source?.getText()).toContain("Gone"));
    expect(editor.source?.getText()).not.toContain("Keep");
  });

  it("opens from the ribbon's trailing Find affordance (C6)", async () => {
    await renderReady();
    const trailing = document.querySelector<HTMLElement>("[data-ribbon-trailing]")!;
    expect(trailing).not.toBeNull();
    fireEvent.click(trailing.querySelector("button")!);
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
  });
});
