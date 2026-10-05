import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { PptxNodeBox } from "../canvas/render-tree";
import { box } from "../canvas/pptx-render-fixtures";
import type { PptxSelectionController } from "../selection/use-pptx-selection";
import { usePptxSelection } from "../selection/use-pptx-selection";
import { PptxTextEditLayer, PptxTextEditorOverlay, type PptxTextCommit } from "./pptx-text-editor";
import type { PptxTextTarget } from "./text-model";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const page = { widthPx: 960, heightPx: 540 };

const target: PptxTextTarget = { sourceId: "title", box: { x: 100, y: 50, w: 400, h: 80 }, text: "Original title", fontSizePx: 24 };

function controller(overrides: Partial<PptxSelectionController> = {}): PptxSelectionController {
  return {
    selection: { ids: [] }, bounds: null, previews: [], marquee: null, canDelete: false,
    clear: vi.fn(), select: vi.fn(), selectAll: vi.fn(), deleteSelection: vi.fn(),
    onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(),
    onContextPointerDown: vi.fn(), elementAt: vi.fn(() => null),
    ...overrides,
  } as PptxSelectionController;
}

describe("PptxTextEditLayer", () => {
  it("opens the editor on a double-click of a text target", () => {
    const onOpen = vi.fn();
    const { container } = render(<PptxTextEditLayer slideIndex={0} targets={[target]} page={page} displayWidthPx={960} displayHeightPx={540} controller={controller()} activeId={null} onOpen={onOpen} />);
    fireEvent.doubleClick(container.querySelector("[data-pptx-text-target='title']")!);
    expect(onOpen).toHaveBeenCalledWith(target);
  });

  it("positions hit boxes in percent of the page", () => {
    const { container } = render(<PptxTextEditLayer slideIndex={0} targets={[target]} page={page} displayWidthPx={1234} displayHeightPx={700} controller={controller()} activeId={null} onOpen={vi.fn()} />);
    const hit = container.querySelector("[data-pptx-text-target='title']") as HTMLElement;
    expect(hit.style.left).toBe(`${(100 / 960) * 100}%`);
    expect(hit.style.top).toBe(`${(50 / 540) * 100}%`);
    expect(hit.style.width).toBe(`${(400 / 960) * 100}%`);
    expect(hit.style.height).toBe(`${(80 / 540) * 100}%`);
  });

  it("selects the element first on right-click without capture or default prevention", () => {
    const c = controller();
    const { container } = render(<PptxTextEditLayer slideIndex={0} targets={[target]} page={page} displayWidthPx={960} displayHeightPx={540} controller={c} activeId={null} onOpen={vi.fn()} />);
    const hit = container.querySelector("[data-pptx-text-target='title']") as HTMLElement;
    const notPrevented = fireEvent.pointerDown(hit, { button: 2, clientX: 0, clientY: 0 });
    expect(c.onContextPointerDown).toHaveBeenCalledTimes(1);
    expect(c.onPointerDown).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
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

  it("keeps native editing keys away from the canvas handler", () => {
    const parentKey = vi.fn();
    const view = render(
      <div role="presentation" onKeyDown={parentKey}>
        <PptxTextEditorOverlay slideIndex={2} target={target} page={page} displayWidthPx={960} displayHeightPx={540} onCommitText={vi.fn()} onCancel={vi.fn()} />
      </div>,
    );
    const editor = view.container.querySelector("[data-pptx-text-editor]") as HTMLElement;
    for (const init of [{ key: "a", ctrlKey: true }, { key: "z", ctrlKey: true }, { key: "y", ctrlKey: true }, { key: "Delete" }, { key: "Backspace" }, { key: "ArrowRight" }]) {
      const notPrevented = fireEvent.keyDown(editor, init);
      expect(notPrevented).toBe(true);
    }
    expect(parentKey).not.toHaveBeenCalled();
  });

  it("positions the overlay in percent of the page", () => {
    const { view } = open();
    const overlay = view.container.querySelector("[data-pptx-text-editor-overlay]") as HTMLElement;
    expect(overlay.style.left).toBe(`${(100 / 960) * 100}%`);
    expect(overlay.style.width).toBe(`${(400 / 960) * 100}%`);
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
describe("PptxTextEditLayer double-click through the selection hit test (F1)", () => {
  // A picture painted over the right half of the title, as in a real deck with an occluder.
  const boxes: PptxNodeBox[] = [
    { sourceId: "title", type: "text", box: box({ x: 100, y: 50, w: 400, h: 80 }) },
    { sourceId: "pic", type: "picture", box: box({ x: 300, y: 40, w: 300, h: 100 }) },
  ];

  function Harness({ onOpen }: { onOpen: (t: PptxTextTarget) => void }): ReactElement {
    const selection = usePptxSelection({ slideIndex: 0, boxes, page, fitWidthPx: 960, scale: 1, interactive: true });
    return <PptxTextEditLayer slideIndex={0} targets={[target]} page={page} controller={selection} activeId={null} onOpen={onOpen} />;
  }

  function mount(onOpen: (t: PptxTextTarget) => void) {
    const view = render(<Harness onOpen={onOpen} />);
    const layer = view.container.querySelector("[data-pptx-text-layer]") as HTMLElement;
    layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) });
    return view.container.querySelector("[data-pptx-text-target='title']") as HTMLElement;
  }

  it("opens nothing when a picture is painted over the double-click point", () => {
    const onOpen = vi.fn();
    fireEvent.doubleClick(mount(onOpen), { clientX: 400, clientY: 90 });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the text on the uncovered part of the element", () => {
    const onOpen = vi.fn();
    fireEvent.doubleClick(mount(onOpen), { clientX: 150, clientY: 90 });
    expect(onOpen).toHaveBeenCalledWith(target);
  });

  it("asks the controller with the page point of the click", () => {
    const elementAt = vi.fn(() => "title");
    const onOpen = vi.fn();
    const { container } = render(<PptxTextEditLayer slideIndex={0} targets={[target]} page={page} displayWidthPx={480} displayHeightPx={270} controller={controller({ elementAt })} activeId={null} onOpen={onOpen} />);
    const layer = container.querySelector("[data-pptx-text-layer]") as HTMLElement;
    layer.getBoundingClientRect = () => ({ left: 10, top: 20, width: 480, height: 270, right: 490, bottom: 290, x: 10, y: 20, toJSON: () => ({}) });
    fireEvent.doubleClick(container.querySelector("[data-pptx-text-target='title']")!, { clientX: 10 + 240, clientY: 20 + 135 });
    expect(elementAt).toHaveBeenCalledWith({ x: 480, y: 270 });
    expect(onOpen).toHaveBeenCalledWith(target);
  });
});

describe("PptxTextEditorOverlay host-command chords (F2)", () => {
  function mountEditor() {
    const parentKey = vi.fn();
    const view = render(
      <div role="presentation" onKeyDown={parentKey}>
        <PptxTextEditorOverlay slideIndex={2} target={target} page={page} onCommitText={vi.fn()} onCancel={vi.fn()} />
      </div>,
    );
    return { parentKey, editor: view.container.querySelector("[data-pptx-text-editor]") as HTMLElement };
  }

  it("lets save, find and F1 bubble to the deck without preventing them", () => {
    const { parentKey, editor } = mountEditor();
    for (const init of [{ key: "s", ctrlKey: true }, { key: "f", metaKey: true }, { key: "F1" }]) {
      fireEvent.keyDown(editor, init);
    }
    expect(parentKey).toHaveBeenCalledTimes(3);
  });

  it("still keeps real editing keys, caret keys, typing and composition away from the canvas", () => {
    const { parentKey, editor } = mountEditor();
    for (const init of [
      { key: "a", ctrlKey: true }, { key: "z", ctrlKey: true }, { key: "z", ctrlKey: true, shiftKey: true }, { key: "y", ctrlKey: true },
      { key: "Delete" }, { key: "Backspace" }, { key: "Home" }, { key: "End" }, { key: "ArrowDown" }, { key: "PageDown" },
      { key: "F2" }, { key: "x" }, { key: "?", shiftKey: true }, { key: "s" }, { key: "Process", isComposing: true }, { key: "s", ctrlKey: true, isComposing: true },
    ]) {
      fireEvent.keyDown(editor, init);
    }
    expect(parentKey).not.toHaveBeenCalled();
  });
});
