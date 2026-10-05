import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { MarkdownEditor } from "./editor";
import { HeaderActionsMenuItems, HeaderActionsSlotProvider } from "../../layout/header-actions-slot";
import { DropdownMenu, DropdownMenuContent } from "@uniwork/ui/components/ui/dropdown-menu";
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

function renderEditor(options: { preview?: IsolatedPreviewPort; coordinator?: ReturnType<typeof coordinator>; permissions?: { canCopy?: boolean; canPaste?: boolean }; assetFailures?: Readonly<Record<string, "ready" | "missing" | "unauthorised" | "failed" | boolean>>; capability?: TextCapability & { format: "md" }; openFails?: boolean; text?: string; manifest?: { entries: readonly { key?: string; asset_id?: string; status?: "ready" | "missing" | "unauthorised" | "failed" }[] } | null; pageMenu?: boolean } = {}) {
  let text = options.text ?? FIXTURE;
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
    getAssetManifest: () => options.manifest ?? { entries: [{ key: "assets/logo.png", asset_id: "asset-logo" }] },
  };
  const outcome: MarkdownOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
  const saveCoordinator = options.coordinator ?? coordinator();
  const open = vi.fn(async () => options.openFails ? ({ outcome: "failed", document_id: "doc", format: "md", failure_class: "engine_error", message: "boom" } as MarkdownOpenOutcome) : outcome);
  const editor = <MarkdownEditor documentKey="doc" editor={handle} open={{ open }} coordinator={saveCoordinator} capability={options.capability ?? CAPABILITY} permissions={options.permissions} assetFailures={options.assetFailures} preview={options.preview} />;
  // The page overflow (⋯) menu the host page owns; the editor contributes its
  // print/export entries to it through `HeaderActionsFill` (M-6/C4).
  const rendered = options.pageMenu
    ? render(
        <HeaderActionsSlotProvider>
          <DropdownMenu open><DropdownMenuContent><HeaderActionsMenuItems /></DropdownMenuContent></DropdownMenu>
          {editor}
        </HeaderActionsSlotProvider>,
      )
    : render(editor);
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

  it("routes Save through the coordinator from the document shortcut and disposes on unmount", async () => {
    // F2: the per-surface Save button is gone; the page header cluster owns it
    // and the surface keeps only the Ctrl+S handshake.
    const { handle, saveCoordinator, unmount } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.queryByTestId("md-save")).toBeNull();
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

  it("keeps a read-only document unsavable and reports it in the status bar", async () => {
    const { saveCoordinator } = renderEditor({ capability: { ...CAPABILITY, status: "readonly" } });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.getByTestId("md-readonly")).toHaveTextContent("Read-only");
    fireEvent.keyDown(screen.getByTestId("md-editor"), { key: "s", ctrlKey: true });
    expect(saveCoordinator.save).not.toHaveBeenCalled();
  });

  it("blocks Save when the host reports a failed asset", async () => {
    const { saveCoordinator } = renderEditor({ assetFailures: { "assets/bad.png": "failed" } });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("This document cannot be saved until every asset is available.");
    fireEvent.keyDown(screen.getByTestId("md-editor"), { key: "s", ctrlKey: true });
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

  it("keeps the shared frame and no inner header with or without a page header slot", async () => {
    // F1/F2: the ready state is the Office frame, edge to edge, and the surface
    // never draws its own header or Save row whether or not a page header exists.
    const rendered = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(rendered.container.querySelector("[data-office-frame]")).not.toBeNull();
    expect(rendered.container.querySelector("[data-testid='md-editor'] header")).toBeNull();
    expect(screen.queryByTestId("md-save")).toBeNull();
    rendered.unmount();

    let text = FIXTURE;
    const handle: MarkdownEditorHandle = {
      format: "md",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 2,
      captureSnapshot: vi.fn(async () => ({ generation: 2, fingerprint: "fp", value: { text } })),
      undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), cancel: vi.fn(),
      source: { getText: () => text, setText: (next) => { text = next; } },
      getAssetManifest: () => ({ entries: [] }),
    };
    const outcome: MarkdownOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
    const withShell = render(
      <HeaderActionsSlotProvider>
        <MarkdownEditor documentKey="doc" editor={handle} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator()} capability={CAPABILITY} />
      </HeaderActionsSlotProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(withShell.container.querySelector("[data-office-frame]")).not.toBeNull();
    expect(withShell.container.querySelector("[data-testid='md-editor'] header")).toBeNull();
    expect(screen.queryByTestId("md-save")).toBeNull();
  });

  it("routes undo and redo to the engine in source mode", async () => {
    const { handle } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    switchToSource();
    const source = (await screen.findByTestId("md-source")) as HTMLTextAreaElement;
    const before = source.value;
    vi.mocked(handle.undo!).mockImplementation(() => { handle.source?.setText("undo result"); });
    vi.mocked(handle.redo!).mockImplementation(() => { handle.source?.setText(before); });
    // F3: the ribbon's quick access drives the VISUAL pane; in source mode the
    // frame's subbar row is the one wired to the host snapshot stack.
    const toolbar = within(screen.getByTestId("md-subbar"));
    fireEvent.click(toolbar.getByRole("button", { name: "Undo" }));
    expect(source.value).toBe("undo result");
    fireEvent.click(toolbar.getByRole("button", { name: "Redo" }));
    expect(handle.undo).toHaveBeenCalledTimes(1);
    expect(handle.redo).toHaveBeenCalledTimes(1);
    expect(source.value).toBe(before);
  });
});

/** The live TipTap instance the production surface mounted (M1's `onEditorReady`
 *  publishes it on the ProseMirror DOM node, the hook every other test uses). */
function liveEditor(): Editor {
  const dom = document.querySelector<HTMLElement & { editor: Editor }>(".ProseMirror");
  if (!dom?.editor) throw new Error("the production surface mounted no live editor");
  return dom.editor;
}

/** Route characters through `handleTextInput` exactly the way prosemirror-view
 *  does, so the slash plugin's trigger arming sees a real typed `/`. */
function typeChars(editor: Editor, input: string) {
  for (const char of input) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (fn) =>
      fn(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

/** Park the cursor inside the document's first table cell. */
function selectFirstTableCell(editor: Editor) {
  let inside = -1;
  editor.state.doc.descendants((node, pos) => {
    if (inside === -1 && node.type.name === "tableCell") { inside = pos + 2; return false; }
    return true;
  });
  expect(inside).toBeGreaterThan(0);
  act(() => { editor.commands.setTextSelection(inside); });
}

/** A PADDED GFM table: M1's byte-identity rule keeps an unpadded one opaque. */
const TABLE_FIXTURE = ["# Title", "", "| col a | col b |", "| ----- | ----- |", "| 1     | 2     |", ""].join("\n");

describe("MarkdownEditor mounts the Markdown features (production surface)", () => {
  it("registers the slash menu on the live instance: a typed / opens it", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".ProseMirror[contenteditable='true']")).toBeTruthy());
    expect(document.querySelector('[data-testid="md-slash-list"]')).toBeNull();
    await act(async () => {
      liveEditor().commands.focus("end");
      typeChars(liveEditor(), "/");
    });
    await waitFor(() => expect(document.querySelector('[data-testid="md-slash-list"]')).not.toBeNull());
    // The 14 block items the demo needs (table + code block among them).
    const ids = [...document.querySelectorAll("[data-slash-item]")].map((node) => node.getAttribute("data-slash-item"));
    expect(ids).toContain("table");
    expect(ids).toContain("codeBlock");
  });

  it("mounts the table context toolbar once the selection is inside a table", async () => {
    renderEditor({ text: TABLE_FIXTURE });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".ProseMirror[contenteditable='true']")).toBeTruthy());
    expect(document.querySelector('[data-testid="md-table-menu"]')).toBeNull();
    selectFirstTableCell(liveEditor());
    await waitFor(() => expect(document.querySelector('[data-testid="md-table-menu"]')).not.toBeNull());
    expect(document.querySelector('[data-table-action="deleteTable"]')).not.toBeNull();
  });

  it("opens the find panel on Ctrl+F and the replace row on Ctrl+H", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.queryByTestId("find-replace-panel")).toBeNull();
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    // Find-only: no replace row.
    expect(screen.queryByTestId("find-replace-value")).toBeNull();
    fireEvent.keyDown(document, { key: "h", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("find-replace-value")).toBeInTheDocument());
  });

  it("renders the far-right Find affordance the ribbon only shows when onFind is passed", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    const trailing = document.querySelector<HTMLElement>("[data-ribbon-trailing]")!;
    const find = within(trailing).getByRole("button", { name: "Find" });
    fireEvent.click(find);
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
  });

  it("toggles the outline and front-matter panes from the ribbon's view controls", async () => {
    renderEditor({ text: "---\ntitle: Keep\n---\n\n# Title\n\nBody paragraph.\n" });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.queryByTestId("md-outline")).toBeNull();
    expect(screen.queryByTestId("md-frontmatter")).toBeNull();
    fireEvent.click(document.querySelector('[data-ribbon-item="viewOutline"]')!);
    await waitFor(() => expect(screen.getByTestId("md-outline")).toBeInTheDocument());
    // The outline lists the fixture's heading and jumps the editor on click.
    const jump = await waitFor(() => {
      const button = screen.getByTestId("md-outline-list").querySelector("button");
      expect(button).not.toBeNull();
      return button!;
    });
    act(() => { fireEvent.click(jump); });
    expect(liveEditor().state.selection.from).toBeGreaterThan(0);
    fireEvent.click(document.querySelector('[data-ribbon-item="viewFrontmatter"]')!);
    await waitFor(() => expect(screen.getByTestId("md-frontmatter")).toBeInTheDocument());
    expect((screen.getByTestId("md-frontmatter-text") as HTMLTextAreaElement).value).toContain("title: Keep");
  });

  it("prints the SANITIZED copy through the host print path, never the raw source", async () => {
    renderEditor({ text: "# Bao cao\n\n<script>parent.postMessage(\"x\", \"*\")</script>\n\n[click](javascript:alert(2))\n", pageMenu: true });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Print" }));
    // The port writes the copy into an off-screen frame and prints only that
    // frame, so the app chrome is never part of the job.
    const frame = document.querySelector("iframe")!;
    expect(frame).not.toBeNull();
    const html = frame.contentDocument?.documentElement.outerHTML ?? "";
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain("Bao cao");
  });

  it("offers the print/export entries in the page overflow menu, with the exports disabled", async () => {
    renderEditor({ pageMenu: true });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Print" })).toBeInTheDocument();
    for (const label of ["Export PDF", "Export DOCX"]) {
      const item = within(menu).getByRole("menuitem", { name: label });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveAttribute("title", "This export format is not supported yet.");
    }
  });
});

/**
 * UNI-928 F1/F2/F8: the Markdown ready state is the shared Office frame and
 * nothing else. One ribbon region, exactly one 28px status bar, no inner card,
 * no inner title and no per-surface Save row.
 */
describe("MarkdownEditor mounts the shared Office frame (F1/F2/F8)", () => {
  it("mounts OfficeFrame with the Markdown ribbon, one status bar and no inner chrome", async () => {
    const { container } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    const frame = container.querySelector<HTMLElement>("[data-office-frame]");
    expect(frame).not.toBeNull();
    // F1: the ribbon is the frame's first slot and the canvas the editor's pane.
    expect(frame!.querySelector('[data-office-ribbon="markdown"]')).not.toBeNull();
    expect(frame!.querySelector("[data-office-canvas]")).not.toBeNull();
    // C9/B-1: no floating command button over the canvas - the old md-more
    // trigger (which also carried a raw i18n key) is gone.
    expect(screen.queryByTestId("md-more")).toBeNull();
    expect(frame!.querySelector('[data-testid="md-more"]')).toBeNull();
    // C5: the visual canvas draws no empty subbar row either; the row appears
    // only in source mode, where the host clipboard controls live.
    expect(screen.queryByTestId("md-subbar")).toBeNull();
    switchToSource();
    await screen.findByTestId("md-source");
    const subbar = screen.getByTestId("md-subbar");
    const canvas = frame!.querySelector("[data-office-canvas]")!;
    expect(canvas.contains(subbar)).toBe(false);
    expect(subbar.parentElement).toBe(frame);
    // F8: exactly one status bar, with the help "?" affordance last.
    expect(container.querySelectorAll("[data-office-status-bar]")).toHaveLength(1);
    const help = screen.getByTestId("md-shortcuts-help-trigger");
    expect(help).toHaveAttribute("aria-haspopup", "dialog");
    // F2: no inner title and no card around the editor.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(container.querySelector("[data-testid='md-editor']")!.className).not.toMatch(/rounded-/);
    expect(container.querySelector("[data-testid='md-editor']")!.className).not.toMatch(/border(\s|$)/);
  });

  it("draws no empty asset row: one status band for a document with no assets (D-md/F9)", async () => {
    const { container } = renderEditor({ manifest: { entries: [] } });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    // F9: the "no assets" strip is not rendered at all, so the status row is
    // the ONE band under the canvas.
    expect(screen.queryByTestId("md-assets")).toBeNull();
    expect(screen.queryByTestId("asset-manifest-empty")).toBeNull();
    expect(container.querySelectorAll("[data-office-status-bar]")).toHaveLength(1);
    expect(screen.getByTestId("md-shortcuts-help-trigger")).toBeInTheDocument();
  });

  it("keeps the assets strip and the status row as one band when assets exist (D-md/F9)", async () => {
    const { container } = renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    expect(screen.getByTestId("md-assets")).toBeInTheDocument();
    // The strip keeps the top separator; the joined status row drops its own,
    // so there is no second full-width border line.
    const statusBar = container.querySelector<HTMLElement>("[data-office-status-bar]")!;
    expect(statusBar.className).toContain("border-t-0");
  });

  it("opens the shortcuts help dialog from the status bar ?", async () => {
    // Mount-level coverage only: the status bar "?" opens the dialog with the
    // six chord rows. The resolved `office.markdown.shortcuts.*` copy is
    // asserted in markdown/status-bar.test.tsx.
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("md-shortcuts-help-trigger"));
    const dialog = await screen.findByTestId("md-shortcuts-dialog");
    expect(dialog).toHaveTextContent("Ctrl+S");
    expect(within(dialog).getAllByRole("term")).toHaveLength(6);
  });

  it("keeps the open and error states rendering outside the frame", async () => {
    const { open } = renderEditor({ openFails: true });
    await waitFor(() => expect(screen.getByTestId("md-error-state")).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("md-shortcuts-help-trigger")).toBeNull();
  });
});

/**
 * VFIXB2-f — the mount-publish regression (UNI-928).
 *
 * TrailingNode (`@tiptap/extensions`, in the shared extension set) appends an
 * empty paragraph on EVERY dispatched transaction whose last block is not a
 * paragraph. The find panel clears its highlight on mount, and that clear used
 * to make the transaction `docChanged`, so M1 published and the shared text
 * port was rewritten with `source + "\n\n"` — bytes the user never wrote — on a
 * plain (even read-only) open. The paint now carries `preventUpdate`, which
 * makes TipTap skip `update` even when an appended transaction changed the doc.
 */
describe("MarkdownEditor mount byte-identity (VFIXB2-f)", () => {
  /** The document ends in a raw HTML comment: TrailingNode appends on any dispatch. */
  const RAW_ENDING = "# Title\n\nsome text\n\n<!-- tail -->";

  it("opens a raw-ending document without dirtying it or touching the bytes", async () => {
    const { handle, saveCoordinator } = renderEditor({ text: RAW_ENDING });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".ProseMirror[contenteditable='true']")).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    expect(saveCoordinator.markDirty).not.toHaveBeenCalled();
    expect(saveCoordinator.checkpoint).not.toHaveBeenCalled();
    expect(handle.source!.getText()).toBe(RAW_ENDING);
  });

  it("does not rewrite the buffer on a read-only open", async () => {
    const { handle, saveCoordinator } = renderEditor({ text: RAW_ENDING, capability: { ...CAPABILITY, status: "readonly" } });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    expect(saveCoordinator.markDirty).not.toHaveBeenCalled();
    expect(handle.source!.getText()).toBe(RAW_ENDING);
  });

  it("does not checkpoint or grow the tail across a visual -> source -> visual toggle", async () => {
    const { handle, saveCoordinator } = renderEditor({ text: RAW_ENDING });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    await act(async () => { await Promise.resolve(); });
    switchToSource();
    await screen.findByTestId("md-source");
    fireEvent.click(screen.getByText("Visual"));
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    await act(async () => { await Promise.resolve(); });
    expect(saveCoordinator.checkpoint).not.toHaveBeenCalled();
    expect(saveCoordinator.markDirty).not.toHaveBeenCalled();
    // The remount must not append another TrailingNode tail to the source.
    expect(handle.source!.getText()).toBe(RAW_ENDING);
  });

  it("checkpoints the FIRST edit of a clean-mounting (paragraph-ending) document", async () => {
    const CLEAN = "# Title\n\nsome text\n";
    const { handle, saveCoordinator } = renderEditor({ text: CLEAN });
    await waitFor(() => expect(screen.getByTestId("md-wysiwyg")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".ProseMirror[contenteditable='true']")).toBeTruthy());
    // Mounting this document dispatches nothing, so no checkpoint has fired yet.
    expect(saveCoordinator.checkpoint).not.toHaveBeenCalled();
    await act(async () => {
      liveEditor().commands.focus("end");
      typeChars(liveEditor(), "x");
    });
    await waitFor(() => expect(saveCoordinator.checkpoint).toHaveBeenCalledTimes(1));
    expect(saveCoordinator.markDirty).toHaveBeenCalled();
    expect(handle.source!.getText()).not.toBe(CLEAN);
  });
});
