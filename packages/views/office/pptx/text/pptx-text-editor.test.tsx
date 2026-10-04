import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { PptxSelectionController } from "../selection/use-pptx-selection";
import { PptxTextEditLayer, PptxTextEditorOverlay, type PptxTextCommit } from "./pptx-text-editor";
import type { PptxTextTarget } from "./text-model";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const page = { widthPx: 960, heightPx: 540 };

const target: PptxTextTarget = { sourceId: "title", box: { x: 100, y: 50, w: 400, h: 80 }, text: "Original title", fontSizePx: 24 };

function controller(overrides: Partial<PptxSelectionController> = {}): PptxSelectionController {
  return {
    selection: { ids: [] }, bounds: null, previews: [], marquee: null, canDelete: false,
    clear: vi.fn(), selectAll: vi.fn(), deleteSelection: vi.fn(),
    onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(),
    ...overrides,
  };
}

describe("PptxTextEditLayer", () => {
  it("opens the editor on a double-click of a text target", () => {
    const onOpen = vi.fn();
    const { container } = render(<PptxTextEditLayer slideIndex={0} targets={[target]} page={page} displayWidthPx={960} displayHeightPx={540} controller={controller()} activeId={null} onOpen={onOpen} />);
    fireEvent.doubleClick(container.querySelector("[data-pptx-text-target='title']")!);
    expect(onOpen).toHaveBeenCalledWith(target);
  });

  it("forwards pointer gestures to the selection controller and hides the active target", () => {
    const c = controller();
    const { container } = render(<PptxTextEditLayer slideIndex={0} targets={[target]} page={page} displayWidthPx={960} displayHeightPx={540} controller={c} activeId="title" onOpen={vi.fn()} />);
    expect(container.querySelector("[data-pptx-text-target='title']")).toBeNull();
    const other = { ...target, sourceId: "subtitle", box: { x: 100, y: 200, w: 400, h: 60 } };
    const view = render(<PptxTextEditLayer slideIndex={0} targets={[other]} page={page} displayWidthPx={960} displayHeightPx={540} controller={c} activeId="title" onOpen={vi.fn()} />);
    const hit = view.container.querySelector("[data-pptx-text-target='subtitle']") as HTMLElement;
    fireEvent.pointerDown(hit, { button: 0, clientX: 0, clientY: 0 });
    expect(c.onPointerDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(hit, { button: 0, clientX: 0, clientY: 0 });
    expect(c.onPointerUp).toHaveBeenCalledTimes(1);
  });
});

describe("PptxTextEditorOverlay", () => {
  function open(props: Partial<{ onCommitText: (c: PptxTextCommit) => void; onCancel: () => void }> = {}) {
    const onCommitText = props.onCommitText ?? vi.fn();
    const onCancel = props.onCancel ?? vi.fn();
    const view = render(<PptxTextEditorOverlay slideIndex={2} target={target} page={page} displayWidthPx={960} displayHeightPx={540} onCommitText={onCommitText} onCancel={onCancel} />);
    return { view, onCommitText, onCancel };
  }

  it("seeds the contenteditable with the element's text and focuses it", () => {
    const { view } = open();
    const editor = view.container.querySelector("[data-pptx-text-editor]") as HTMLElement;
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor.textContent).toBe("Original title");
    expect(document.activeElement).toBe(editor);
  });

  it("commits the typed paragraphs on Ctrl+Enter", () => {
    const { view, onCommitText } = open();
    const editor = view.container.querySelector("[data-pptx-text-editor]") as HTMLElement;
    editor.textContent = "Edited title";
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onCommitText).toHaveBeenCalledWith({ slideIndex: 2, elementId: "title", paragraphs: [{ runs: [{ text: "Edited title" }] }] });
  });

  it("commits on blur (click outside)", () => {
    const { view, onCommitText } = open();
    const editor = view.container.querySelector("[data-pptx-text-editor]") as HTMLElement;
    editor.textContent = "Blurred title";
    fireEvent.blur(editor);
    expect(onCommitText).toHaveBeenCalledWith({ slideIndex: 2, elementId: "title", paragraphs: [{ runs: [{ text: "Blurred title" }] }] });
  });

  it("reads block-level paragraphs as separate paragraphs", () => {
    const { view, onCommitText } = open();
    const editor = view.container.querySelector("[data-pptx-text-editor]") as HTMLElement;
    editor.innerHTML = "<div>First</div><div>Second</div>";
    fireEvent.blur(editor);
    expect(onCommitText).toHaveBeenCalledWith({ slideIndex: 2, elementId: "title", paragraphs: [{ runs: [{ text: "First" }] }, { runs: [{ text: "Second" }] }] });
  });

  it("cancels on Escape without committing", () => {
    const { view, onCommitText, onCancel } = open();
    const editor = view.container.querySelector("[data-pptx-text-editor]") as HTMLElement;
    editor.textContent = "Discarded";
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommitText).not.toHaveBeenCalled();
  });

  it("refuses an empty commit and keeps the overlay open", () => {
    const { view, onCommitText, onCancel } = open();
    const editor = view.container.querySelector("[data-pptx-text-editor]") as HTMLElement;
    editor.textContent = "   ";
    fireEvent.blur(editor);
    expect(onCommitText).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Text cannot be empty");
  });
});