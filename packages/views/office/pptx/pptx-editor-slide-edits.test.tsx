import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { box, run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor, type PptxEditorProps } from "./pptx-editor";

/**
 * UNI-958: the three edits the Windows desktop smoke could not make - Home/Insert
 * "New slide", Delete on a slide thumbnail, and typing over a selected title -
 * driven through the real editor.
 */
initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const size = { cx: 12192000, cy: 6858000 };
const slidesOf = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}` }));
const deckOf = (count: number, revision: number) => ({ deck: { slides: slidesOf(count), size }, revision });

function makeHost(): OfficeHost {
  return { read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: vi.fn() as unknown as OfficeHost["ipc"]["call"], send: vi.fn(), subscribe: vi.fn() } };
}

function makeHandle(withEdit = true) {
  const handle = { format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), ...(withEdit ? { edit: vi.fn(async () => ({ revision: 2 })) } : {}) };
  return handle as unknown as EditorHandle & { edit: ReturnType<typeof vi.fn> };
}

const module: PptxRendererModule = {
  makeViewport: (deckSize, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (deckSize.cy / deckSize.cx), scale: 1 }),
  buildRenderSlide: () => slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Title" })], top: 0, height: 24 }] }) })]),
};

const twoShapes: PptxRendererModule = {
  ...module,
  buildRenderSlide: () => slide([
    shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Title" })], top: 0, height: 24 }] }) }),
    shapeNode({ id: "r_shape-2", sourceId: "shape-2", box: box({ x: 40, y: 300, w: 200, h: 120 }), text: textLayout({ lines: [{ runs: [run({ text: "Body" })], top: 0, height: 24 }] }) }),
  ]),
};

async function renderEditor(count: number, props: Partial<PptxEditorProps> = {}, renderer: PptxRendererModule = module) {
  const editorHandle = props.editorHandle ?? makeHandle();
  const element = (extra: Partial<PptxEditorProps> = {}) => (
    <PptxEditor host={makeHost()} editorHandle={editorHandle} loadRendererModule={async () => renderer} slides={slidesOf(count)} deck={deckOf(count, 1)} {...props} {...extra} />
  );
  const view = render(element());
  await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
  return { editorHandle: editorHandle as EditorHandle & { edit: ReturnType<typeof vi.fn> }, rerender: (extra: Partial<PptxEditorProps>) => view.rerender(element(extra)) };
}

const canvas = () => screen.getByRole("application", { name: "PowerPoint slide canvas" });
const railButton = (index: number) => document.querySelector(`[data-pptx-slide-rail] [data-slide-index="${index}"]`) as HTMLElement;
const newSlide = () => document.querySelector('[data-ribbon-item="new-slide"]') as HTMLElement;

function selectTitle() {
  const overlay = canvas().querySelector("[data-pptx-selection-overlay]") as HTMLElement;
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  fireEvent.pointerDown(overlay, { button: 0, clientX: 100, clientY: 80 });
  fireEvent.pointerUp(overlay, { button: 0, clientX: 100, clientY: 80 });
}

describe("PptxEditor slide edits (UNI-958)", () => {
  it("New slide adds a slide after the current one and selects it, instead of toggling the sorter", async () => {
    const onSlideSelect = vi.fn();
    const { editorHandle, rerender } = await renderEditor(3, { selectedIndex: 1, onSlideSelect });
    expect(newSlide()).not.toHaveAttribute("aria-pressed");
    fireEvent.click(newSlide());
    await waitFor(() => expect(editorHandle.edit).toHaveBeenCalledWith([{ op: "add_blank_slide", slideIndex: 1 }]));
    expect(document.querySelector("[data-pptx-sorter]")).toBeNull();
    // The new slide is selected once the host re-reads the longer deck.
    rerender({ selectedIndex: 1, onSlideSelect, slides: slidesOf(4), deck: deckOf(4, 2) });
    await waitFor(() => expect(onSlideSelect).toHaveBeenCalledWith(2));
  });

  it("New slide is on the Insert tab too, and disabled with a reason without an edit channel", async () => {
    await renderEditor(2, { editorHandle: makeHandle(false) });
    expect(newSlide()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(newSlide()).toHaveAttribute("aria-disabled", "true");
  });

  it("Delete on a focused slide thumbnail deletes that slide, never the selected shape", async () => {
    const { editorHandle } = await renderEditor(3);
    selectTitle();
    railButton(2).focus();
    fireEvent.keyDown(railButton(2), { key: "Delete" });
    await waitFor(() => expect(editorHandle.edit).toHaveBeenCalledWith([{ op: "delete_slide", slideIndex: 2 }]));
    expect(editorHandle.edit).toHaveBeenCalledTimes(1);
  });

  it("typing over a selected title opens the in-place editor with the typed text", async () => {
    const onCommitText = vi.fn();
    await renderEditor(1, { onCommitText });
    selectTitle();
    canvas().focus();
    fireEvent.keyDown(canvas(), { key: "X" });
    const editor = await waitFor(() => canvas().querySelector("[data-pptx-text-editor]") as HTMLElement);
    expect(editor.textContent).toBe("X");
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onCommitText).toHaveBeenCalledWith(expect.objectContaining({ slideIndex: 0, elementId: "shape-1" })));
    expect(JSON.stringify(onCommitText.mock.calls[0]![0].paragraphs)).toContain('"X"');
    expect(JSON.stringify(onCommitText.mock.calls[0]![0].paragraphs)).not.toContain("Title");
  });

  it("a shortcut chord or a modifier key never starts a text edit", async () => {
    const onCommitText = vi.fn();
    await renderEditor(1, { onCommitText });
    selectTitle();
    fireEvent.keyDown(canvas(), { key: "a", ctrlKey: true });
    fireEvent.keyDown(canvas(), { key: "Shift", shiftKey: true });
    expect(canvas().querySelector("[data-pptx-text-editor]")).toBeNull();
  });

  it("clears the canvas selection on a rail Delete, so the next slide's same-id title is not selected (r2 M1)", async () => {
    const onCommitText = vi.fn();
    const { editorHandle } = await renderEditor(2, { onCommitText });
    selectTitle();
    fireEvent.keyDown(railButton(0), { key: "Delete" });
    await waitFor(() => expect(editorHandle.edit).toHaveBeenCalledWith([{ op: "delete_slide", slideIndex: 0 }]));
    // Slide 2 (now at index 0) has its own "shape-1": a stale selection would let this key replace its text.
    fireEvent.keyDown(canvas(), { key: "X" });
    expect(canvas().querySelector("[data-pptx-text-editor]")).toBeNull();
  });

  it("Backspace on a thumbnail deletes too; the last slide is refused with a visible reason (r2 L2)", async () => {
    const { editorHandle } = await renderEditor(2);
    fireEvent.keyDown(railButton(1), { key: "Backspace" });
    await waitFor(() => expect(editorHandle.edit).toHaveBeenCalledWith([{ op: "delete_slide", slideIndex: 1 }]));
    const single = await renderEditor(1);
    fireEvent.keyDown(document.querySelectorAll("[data-pptx-slide-rail] [data-slide-index='0']")[1] as HTMLElement, { key: "Delete" });
    expect(single.editorHandle.edit).not.toHaveBeenCalled();
    expect(await screen.findByText(/The last slide cannot be deleted/)).toBeInTheDocument();
  });

  it("a slide picked meanwhile wins over the pending New slide selection (r2 L3)", async () => {
    const onSlideSelect = vi.fn();
    const { editorHandle, rerender } = await renderEditor(3, { selectedIndex: 1, onSlideSelect });
    fireEvent.click(newSlide());
    await waitFor(() => expect(editorHandle.edit).toHaveBeenCalled());
    rerender({ selectedIndex: 0, onSlideSelect });
    rerender({ selectedIndex: 0, onSlideSelect, slides: slidesOf(4), deck: deckOf(4, 2) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSlideSelect).not.toHaveBeenCalledWith(2);
  });

  it("Ctrl+Z after New slide runs the handle's undo (one journal step)", async () => {
    const { editorHandle } = await renderEditor(2);
    fireEvent.click(newSlide());
    await waitFor(() => expect(editorHandle.edit).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(canvas(), { key: "z", ctrlKey: true });
    await waitFor(() => expect(editorHandle.undo).toHaveBeenCalledTimes(1));
  });

  it("puts the caret after the typed text, so the next key appends (r2 L5)", async () => {
    await renderEditor(1, { onCommitText: vi.fn() });
    selectTitle();
    fireEvent.keyDown(canvas(), { key: "X" });
    const editor = await waitFor(() => canvas().querySelector("[data-pptx-text-editor]") as HTMLElement);
    const range = window.getSelection()!;
    expect(range.isCollapsed).toBe(true);
    expect(editor.contains(range.anchorNode)).toBe(true);
    expect(range.anchorOffset).toBe(range.anchorNode === editor ? editor.childNodes.length : 1);
  });

  it("does not start editing with two elements selected or inside an IME composition (r2 L1/L5)", async () => {
    await renderEditor(1, { onCommitText: vi.fn() }, twoShapes);
    selectTitle();
    fireEvent.keyDown(canvas(), { key: "x", isComposing: true });
    expect(canvas().querySelector("[data-pptx-text-editor]")).toBeNull();
    fireEvent.keyDown(canvas(), { key: "a", ctrlKey: true });
    fireEvent.keyDown(canvas(), { key: "X" });
    expect(canvas().querySelector("[data-pptx-text-editor]")).toBeNull();
  });
});
