import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import type { PptxRenderNode } from "./canvas/render-tree";
import { box, chartNode, run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor, type PptxEditorProps } from "./pptx-editor";
import type { PptxPanelEdit } from "./pptx-panel-host";

/**
 * UNI-927 W9: the W5 review findings (F1, F3, F9, F11, F12), select-after-insert
 * and the W2 review F3 canvas refocus, driven through the real editor.
 */
initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const deckAt = (revision: number) => ({ deck: { slides: [{ id: "s1" }], size: { cx: 12192000, cy: 6858000 } }, revision });

function makeHost(): OfficeHost {
  return { read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: vi.fn() as unknown as OfficeHost["ipc"]["call"], send: vi.fn(), subscribe: vi.fn() } };
}

function makeHandle(withEdit = true) {
  const handle = { format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), ...(withEdit ? { edit: vi.fn(async () => ({ revision: 2 })) } : {}) };
  return handle as unknown as EditorHandle & { undo: ReturnType<typeof vi.fn> };
}

const title = () => shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Title" })], top: 0, height: 24 }] }) });
const second = () => shapeNode({ id: "r_shape-2", sourceId: "shape-2", box: box({ x: 40, y: 300, w: 200, h: 120 }), text: textLayout({ lines: [{ runs: [run({ text: "Body" })], top: 0, height: 24 }] }) });
const chart = (sourceId = "chart-1") => chartNode({ id: `r_${sourceId}`, sourceId, box: box({ x: 300, y: 200, w: 400, h: 260 }) });

function moduleOf(nodes: () => PptxRenderNode[]): PptxRendererModule {
  return {
    makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
    buildRenderSlide: () => slide(nodes()),
  };
}

async function renderEditor(props: Partial<PptxEditorProps> = {}, nodes: () => PptxRenderNode[] = () => [title(), chart()]) {
  const editorHandle = props.editorHandle ?? makeHandle();
  const module = moduleOf(nodes);
  const element = (extra: Partial<PptxEditorProps> = {}) => (
    <PptxEditor host={makeHost()} editorHandle={editorHandle} loadRendererModule={async () => module} slides={[{ id: "s1" }]} deck={deckAt(1)} {...props} {...extra} />
  );
  const view = render(element());
  await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
  return { editorHandle, rerender: (extra: Partial<PptxEditorProps>) => view.rerender(element(extra)) };
}

const canvas = () => screen.getByRole("application", { name: "PowerPoint slide canvas" });

function clickSlideAt(x: number, y: number) {
  const overlay = canvas().querySelector("[data-pptx-selection-overlay]") as HTMLElement;
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  fireEvent.pointerDown(overlay, { button: 0, clientX: x, clientY: y });
  fireEvent.pointerUp(overlay, { button: 0, clientX: x, clientY: y });
}

const item = (id: string) => document.querySelector(`[data-ribbon-item="${id}"]`) as HTMLElement;

describe("PptxEditor W5 review fixes (UNI-927 W9)", () => {
  it("never undoes the deck behind the open presenter console (F1)", async () => {
    const { editorHandle } = await renderEditor();
    const tab = screen.getByRole("tab", { name: "Slide Show" });
    // Baseline: the chord from a ribbon control inside the editor undoes.
    fireEvent.keyDown(tab, { key: "z", ctrlKey: true });
    expect(editorHandle.undo).toHaveBeenCalledTimes(1);
    fireEvent.click(tab);
    fireEvent.click(item("show-presenter-view"));
    const dialog = screen.getByRole("dialog", { name: "Presenter view" });
    fireEvent.keyDown(dialog, { key: "z", ctrlKey: true });
    fireEvent.keyDown(tab, { key: "z", ctrlKey: true });
    fireEvent.keyDown(tab, { key: "y", ctrlKey: true });
    expect(editorHandle.undo).toHaveBeenCalledTimes(1);
    expect(editorHandle.redo).not.toHaveBeenCalled();
  });

  it("opens the comments panel read-only without an edit channel (F3)", async () => {
    const comments = [{ authorId: 0, author: "Lan", initials: "L", dt: "", idx: 1, text: "Check the numbers" }];
    await renderEditor({ editorHandle: makeHandle(false), panelData: { comments } });
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    const toggle = item("panel-comments");
    expect(toggle).not.toHaveAttribute("aria-disabled");
    fireEvent.click(toggle);
    const panel = screen.getByTestId("pptx-comments-panel");
    expect(panel).toHaveAttribute("data-pptx-comments-mode", "ready");
    expect(within(panel).getByText("Check the numbers")).toBeInTheDocument();
    expect(within(panel).getByTestId("pptx-comments-readonly")).toHaveTextContent("This presentation cannot be edited here");
    expect(within(panel).queryByRole("button", { name: /Post/ })).toBeNull();
  });

  it("applies Bold to every selected text element, not only the anchor (F9)", async () => {
    // W10a (W9 review F2): the whole gesture travels as one batch on the handle's array channel.
    const onApplyEdit = vi.fn(async (_edit: PptxPanelEdit) => undefined);
    const { editorHandle } = await renderEditor({ onApplyEdit }, () => [title(), second(), chart()]);
    const edit = (editorHandle as unknown as { edit: ReturnType<typeof vi.fn> }).edit;
    fireEvent.keyDown(canvas(), { key: "a", ctrlKey: true });
    await waitFor(() => expect(item("font-bold")).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(item("font-bold"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect((edit.mock.calls[0]?.[0] as PptxPanelEdit[]).map((one) => ("elementId" in one ? one.elementId : null))).toEqual(["shape-1", "shape-2"]);
    expect(onApplyEdit).not.toHaveBeenCalled();
  });

  it("enables the context-menu Edit text row only over an editable selection (F11)", async () => {
    await renderEditor({ onCommitText: vi.fn() });
    clickSlideAt(500, 330);
    fireEvent.contextMenu(canvas());
    let menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Edit text/ })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    clickSlideAt(100, 80);
    fireEvent.contextMenu(canvas());
    menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Edit text/ })).not.toHaveAttribute("aria-disabled");
  });

  it("keeps the default-open notes pane on the first Speaker notes press, closes it on the second (F12)", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    const bottom = () => document.querySelector('[data-pptx-panel-placement="bottom"]');
    expect(bottom()).not.toBeNull();
    fireEvent.click(item("speaker-notes"));
    expect(bottom()).not.toBeNull();
    fireEvent.click(item("speaker-notes"));
    expect(bottom()).toBeNull();
    fireEvent.click(item("speaker-notes"));
    expect(bottom()).not.toBeNull();
  });

  it("selects the element an edit minted once the new rendition mounts it", async () => {
    let nodes: PptxRenderNode[] = [title()];
    const onApplyEdit = vi.fn(async () => {
      nodes = [title(), chart("chart-9")];
      return { revision: 2, createdIds: ["chart-9"] };
    });
    const { rerender } = await renderEditor({ onApplyEdit }, () => nodes);
    clickSlideAt(100, 80);
    await waitFor(() => expect(item("font-bold")).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(item("font-bold"));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalled());
    expect(screen.queryByRole("tab", { name: "Chart Design" })).toBeNull();
    rerender({ onApplyEdit, deck: deckAt(2) });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Chart Design" })).toBeInTheDocument());
  });

  it("returns focus to the canvas when the in-place text editor closes (W2 review F3)", async () => {
    const onCommitText = vi.fn();
    await renderEditor({ onCommitText });
    fireEvent.doubleClick(canvas().querySelector("[data-pptx-text-target='shape-1']") as HTMLElement);
    const editor = await waitFor(() => canvas().querySelector("[data-pptx-text-editor]") as HTMLElement);
    editor.focus();
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(canvas().querySelector("[data-pptx-text-editor]")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(canvas()));
    fireEvent.doubleClick(canvas().querySelector("[data-pptx-text-target='shape-1']") as HTMLElement);
    const reopened = await waitFor(() => canvas().querySelector("[data-pptx-text-editor]") as HTMLElement);
    reopened.focus();
    fireEvent.keyDown(reopened, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onCommitText).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(canvas()));
  });
});
