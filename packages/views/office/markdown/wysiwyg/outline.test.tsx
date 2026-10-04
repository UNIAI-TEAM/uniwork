// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { MarkdownOutlinePane, clampOutlineWidth, collectHeadings, OUTLINE_MIN_WIDTH, OUTLINE_MAX_WIDTH } from "./outline";
import { MarkdownWysiwygEditor } from "./editor";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FIXTURE = `# Title

Intro paragraph.

## Section one

### Nested section

## Section two

Body.
`;

function createTextSource(initial: string) {
  let text = initial;
  const listeners = new Set<(next: string) => void>();
  return {
    getText: () => text,
    setText: (next: string) => {
      if (next === text) return;
      text = next;
      listeners.forEach((listener) => listener(next));
    },
    subscribe: (listener: (next: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createHandle(source: ReturnType<typeof createTextSource>): TextEditorHandle {
  return {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { text: source.getText() } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    source,
  };
}

/** Mount the M1 editor and hand its live instance to the outline. */
function Harness({
  handle,
  onNavigate,
  onEditorReady,
}: {
  handle: TextEditorHandle;
  onNavigate?: (heading: { text: string }) => void;
  onEditorReady?: (editor: Editor | null) => void;
}) {
  const [live, setLive] = useState<Editor | null>(null);
  return (
    <div>
      <MarkdownWysiwygEditor
        documentKey="doc"
        editor={handle}
        onEditorReady={(editor) => {
          setLive(editor);
          onEditorReady?.(editor);
        }}
      />
      <MarkdownOutlinePane editor={live} onNavigate={onNavigate} />
    </div>
  );
}

describe("collectHeadings", () => {
  it("lists headings in document order with their level and text", async () => {
    const source = createTextSource(FIXTURE);
    let live: Editor | null = null;
    render(<MarkdownWysiwygEditor documentKey="doc" editor={createHandle(source)} onEditorReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    expect(collectHeadings(live)).toEqual([
      { level: 1, text: "Title", pos: expect.any(Number) },
      { level: 2, text: "Section one", pos: expect.any(Number) },
      { level: 3, text: "Nested section", pos: expect.any(Number) },
      { level: 2, text: "Section two", pos: expect.any(Number) },
    ]);
  });
});

describe("clampOutlineWidth", () => {
  it("keeps the pane within its bounds", () => {
    expect(clampOutlineWidth(10)).toBe(OUTLINE_MIN_WIDTH);
    expect(clampOutlineWidth(9999)).toBe(OUTLINE_MAX_WIDTH);
    expect(clampOutlineWidth(240)).toBe(240);
  });
});

describe("MarkdownOutlinePane", () => {
  it("lists the document headings nested by level", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<Harness handle={handle} />);
    const outline = await waitFor(() => {
      const list = screen.getByTestId("md-outline-list");
      expect(list.querySelectorAll("button").length).toBe(4);
      return list;
    });
    const labels = [...outline.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["Title", "Section one", "Nested section", "Section two"]);
    expect(screen.queryByTestId("md-outline-empty")).toBeNull();
    // The nested heading is indented deeper than its parent.
    const nested = screen.getByTestId("md-outline-list").querySelector<HTMLButtonElement>("button[data-level='3']")!;
    const parent = screen.getByTestId("md-outline-list").querySelector<HTMLButtonElement>("button[data-level='2']")!;
    expect(Number.parseInt(nested.style.paddingLeft, 10)).toBeGreaterThan(Number.parseInt(parent.style.paddingLeft, 10));
  });

  it("scrolls the editor to a heading when clicked", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    const onNavigate = vi.fn();
    let live: Editor | null = null;
    render(<Harness handle={handle} onNavigate={onNavigate} onEditorReady={(editor) => { live = editor; }} />);

    const list = await waitFor(() => {
      const element = screen.getByTestId("md-outline-list");
      expect(element.querySelectorAll("button").length).toBe(4);
      return element;
    });
    const buttons = [...list.querySelectorAll("button")];
    const target = buttons.find((button) => button.textContent === "Section two")!;
    const targetPos = Number.parseInt(target.dataset.pos!, 10);

    await act(async () => {
      fireEvent.click(target);
    });

    // The cursor now sits inside the clicked heading, and the callback fired.
    await waitFor(() => expect(live!.state.selection.from).toBeGreaterThanOrEqual(targetPos));
    expect(live!.state.selection.from).toBeLessThanOrEqual(targetPos + "Section two".length + 2);
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ text: "Section two" }));
  });

  it("shows the empty state when the document has no headings", async () => {
    const handle = createHandle(createTextSource("Just a paragraph.\n"));
    let live: Editor | null = null;
    render(<MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    render(<MarkdownOutlinePane editor={live} />);
    expect(screen.getByTestId("md-outline-empty")).toBeInTheDocument();
  });

  it("resizes with the arrow keys on the handle", () => {
    render(<MarkdownOutlinePane editor={null} />);
    const handle = screen.getByTestId("md-outline-resize");
    const aside = screen.getByLabelText("Outline");
    const start = Number.parseInt((aside as HTMLElement).style.width, 10);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(Number.parseInt((aside as HTMLElement).style.width, 10)).toBeGreaterThan(start);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "Home" });
    expect(Number.parseInt((aside as HTMLElement).style.width, 10)).toBe(OUTLINE_MIN_WIDTH);
    fireEvent.keyDown(handle, { key: "End" });
    expect(Number.parseInt((aside as HTMLElement).style.width, 10)).toBe(OUTLINE_MAX_WIDTH);
  });
});
