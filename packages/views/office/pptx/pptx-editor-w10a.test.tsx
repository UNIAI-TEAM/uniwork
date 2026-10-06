import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import type { PptxRenderNode } from "./canvas/render-tree";
import { box, run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor, type PptxEditorProps } from "./pptx-editor";

/**
 * UNI-927 W10a: the last W9 review findings (F2 one-batch format, F3 read-only
 * speaker notes) and W8 review F2 (a bubbled Ctrl+S commits the open in-place
 * edit before the deck is saved), driven through the real editor.
 */
initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const deck = { deck: { slides: [{ id: "s1" }], size: { cx: 12192000, cy: 6858000 } }, revision: 1 };

function makeHost(): OfficeHost {
  return { read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: vi.fn() as unknown as OfficeHost["ipc"]["call"], send: vi.fn(), subscribe: vi.fn() } };
}

function makeHandle(edit?: (edits: readonly unknown[]) => Promise<unknown>) {
  const handle = { format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), ...(edit ? { edit } : {}) };
  return handle as unknown as EditorHandle & { undo: ReturnType<typeof vi.fn> };
}

const title = () => shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Title" })], top: 0, height: 24 }] }) });
const body = () => shapeNode({ id: "r_shape-2", sourceId: "shape-2", box: box({ x: 40, y: 300, w: 200, h: 120 }), text: textLayout({ lines: [{ runs: [run({ text: "Body" })], top: 0, height: 24 }] }) });

function moduleOf(nodes: () => PptxRenderNode[]): PptxRendererModule {
  return {
    makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
    buildRenderSlide: () => slide(nodes()),
  };
}

async function renderEditor(props: Partial<PptxEditorProps> = {}) {
  const module = moduleOf(() => [title(), body()]);
  render(<PptxEditor host={makeHost()} editorHandle={makeHandle()} loadRendererModule={async () => module} slides={[{ id: "s1" }]} deck={deck} {...props} />);
  await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
}

const canvas = () => screen.getByRole("application", { name: "PowerPoint slide canvas" });
const item = (id: string) => document.querySelector(`[data-ribbon-item="${id}"]`) as HTMLElement;

describe("PptxEditor W9/W8 review fixes (UNI-927 W10a)", () => {
  it("commits the open in-place text edit before a bubbled Ctrl+S saves the deck (W8 review F2)", async () => {
    const order: string[] = [];
    let landCommit = () => {};
    const onCommitText = vi.fn(() => {
      order.push("commit");
      return new Promise<void>((resolve) => { landCommit = () => { order.push("commit-landed"); resolve(); }; });
    });
    const save = vi.fn(async () => { order.push("save"); });
    await renderEditor({ onCommitText, saveCoordinator: { save, getState: () => ({}) as never } });
    fireEvent.doubleClick(canvas().querySelector("[data-pptx-text-target='shape-1']") as HTMLElement);
    const editor = await waitFor(() => canvas().querySelector("[data-pptx-text-editor]") as HTMLElement);
    editor.focus();
    editor.textContent = "Typed title";
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    expect(onCommitText).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ elementId: "shape-1", paragraphs: [expect.objectContaining({ runs: [expect.objectContaining({ text: "Typed title" })] })] }));
    await act(async () => { await Promise.resolve(); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { landCommit(); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["commit", "commit-landed", "save"]);
  });

  it("still saves at once when no in-place edit is open", async () => {
    const save = vi.fn(async () => undefined);
    await renderEditor({ onCommitText: vi.fn(), saveCoordinator: { save, getState: () => ({}) as never } });
    fireEvent.keyDown(canvas(), { key: "s", ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it("keeps Speaker notes openable and closable on a read-only host (W9 review F3)", async () => {
    await renderEditor({ slideNotes: () => "Read me" });
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    const notes = item("speaker-notes");
    expect(notes).not.toHaveAttribute("aria-disabled", "true");
    expect(notes).not.toBeDisabled();
    const bottom = () => document.querySelector('[data-pptx-panel-placement="bottom"]');
    expect(bottom()).not.toBeNull();
    fireEvent.click(notes);
    fireEvent.click(notes);
    expect(bottom()).toBeNull();
    fireEvent.click(notes);
    expect(bottom()).not.toBeNull();
  });

  it("formats every selected text element in ONE channel call, one undo step (W9 review F2)", async () => {
    const edit = vi.fn(async (_edits: readonly unknown[]) => ({ revision: 2 }));
    const handle = makeHandle(edit);
    const onApplyEdit = vi.fn(async () => ({ revision: 2 }));
    await renderEditor({ editorHandle: handle, onApplyEdit });
    fireEvent.keyDown(canvas(), { key: "a", ctrlKey: true });
    await waitFor(() => expect(item("font-bold")).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(item("font-bold"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ op: "set_font", elementId: "shape-1" }),
      expect.objectContaining({ op: "set_font", elementId: "shape-2" }),
    ]);
    expect(onApplyEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(canvas(), { key: "z", ctrlKey: true });
    expect(handle.undo).toHaveBeenCalledTimes(1);
  });
});
