// @vitest-environment jsdom
import { useEffect, useRef, useState } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { MarkdownWysiwygEditor } from "./editor";
import { MarkdownSlash } from "./slash";
import {
  MARKDOWN_SLASH_ITEMS,
  filterMarkdownSlashItems,
  insertMarkdownSlashItem,
  type MarkdownSlashItemId,
} from "./slash-items";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FIXTURE = "# Title\n\nBody paragraph.\n";

function createHandle(initial: string = FIXTURE): TextEditorHandle {
  let text = initial;
  const listeners = new Set<(next: string) => void>();
  return {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { text } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    source: {
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
    },
  };
}

/** The brief's item list, in order. */
const EXPECTED_IDS: MarkdownSlashItemId[] = [
  "paragraph", "heading1", "heading2", "heading3", "bulletList", "orderedList",
  "taskList", "quote", "codeBlock", "table", "hr", "math", "diagram", "image",
];

describe("Markdown slash items", () => {
  it("lists the 14 items the brief names, in order", () => {
    expect(MARKDOWN_SLASH_ITEMS.map((item) => item.id)).toEqual(EXPECTED_IDS);
  });

  it("returns every item for an empty query", () => {
    expect(filterMarkdownSlashItems("", (key) => key)).toHaveLength(14);
  });

  it("filters on the id, an ASCII alias and the translated label", () => {
    const t = (key: string, options?: { lng?: string }) => {
      const id = key.split(".").pop() as MarkdownSlashItemId;
      if (id === "table") return options?.lng === "vi" ? "Bảng" : "Table";
      if (id === "heading2") return options?.lng === "vi" ? "Tiêu đề 2" : "Heading 2";
      if (id === "diagram") return options?.lng === "vi" ? "Sơ đồ" : "Diagram";
      return id;
    };
    expect(filterMarkdownSlashItems("h2", t).map((item) => item.id)).toEqual(["heading2"]);
    expect(filterMarkdownSlashItems("mermaid", t).map((item) => item.id)).toEqual(["diagram"]);
    // Diacritic-insensitive: "bang" matches the Vietnamese label "Bảng".
    expect(filterMarkdownSlashItems("bang", t).map((item) => item.id)).toEqual(["table"]);
    expect(filterMarkdownSlashItems("zzz", t)).toEqual([]);
  });
});

/** A live M1 editor plus the M3 slash mount over one shared text source. */
function Harness({ onReady, chooseImage }: { onReady: (editor: Editor | null) => void; chooseImage?: () => void }) {
  const [handle] = useState(() => createHandle(""));
  const [instance, setInstance] = useState<Editor | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    readyRef.current(instance);
  }, [instance]);
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={setInstance} showRibbon={false} />
      <MarkdownSlash editor={instance} chooseImage={chooseImage} />
    </div>
  );
}

/** Route characters through handleTextInput the way prosemirror-view does. */
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (fn) =>
      fn(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

function slashList(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="md-slash-list"]');
}

async function mountAndType(text: string) {
  let live: Editor | null = null;
  render(<Harness onReady={(editor) => { live = editor; }} />);
  await waitFor(() => expect(live).not.toBeNull());
  await act(async () => {
    live!.commands.focus("end");
    type(live!, text);
  });
  return () => live;
}

describe("Markdown slash menu mount", () => {
  it("opens on a typed slash, filters as you type and closes on Escape", async () => {
    const getEditor = await mountAndType("/");
    await waitFor(() => expect(slashList()).not.toBeNull());
    expect(slashList()!.querySelectorAll("[data-slash-item]")).toHaveLength(14);

    await act(async () => {
      type(getEditor()!, "h2");
    });
    await waitFor(() => {
      const items = slashList()!.querySelectorAll("[data-slash-item]");
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveAttribute("data-slash-item", "heading2");
    });

    await act(async () => {
      fireEvent.keyDown(getEditor()!.view.dom, { key: "Escape" });
    });
    await waitFor(() => expect(slashList()).toBeNull());
    // Escape closes the menu only; the typed text stays untouched.
    expect(getEditor()!.getText()).toBe("/h2");
  });

  it("navigates with the arrow keys and inserts the highlighted item on Enter", async () => {
    const getEditor = await mountAndType("/");
    await waitFor(() => expect(slashList()).not.toBeNull());
    // Highlight starts on the first item (paragraph); ArrowDown moves to h1.
    expect(slashList()!.querySelector('[aria-selected="true"]')).toHaveAttribute("data-slash-item", "paragraph");
    await act(async () => {
      fireEvent.keyDown(getEditor()!.view.dom, { key: "ArrowDown" });
    });
    await waitFor(() =>
      expect(slashList()!.querySelector('[aria-selected="true"]')).toHaveAttribute("data-slash-item", "heading1"),
    );
    await act(async () => {
      fireEvent.keyDown(getEditor()!.view.dom, { key: "Enter" });
    });
    await waitFor(() => expect(slashList()).toBeNull());
    const json = getEditor()!.getJSON();
    expect(json.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(getEditor()!.getText()).not.toContain("/");
  });

  it("wraps the highlight with ArrowUp and keeps Escape's other keys alone", async () => {
    const getEditor = await mountAndType("/");
    await waitFor(() => expect(slashList()).not.toBeNull());
    // ArrowUp from the first item wraps to the last (image).
    await act(async () => {
      fireEvent.keyDown(getEditor()!.view.dom, { key: "ArrowUp" });
    });
    await waitFor(() =>
      expect(slashList()!.querySelector('[aria-selected="true"]')).toHaveAttribute("data-slash-item", "image"),
    );
  });

  it("does not open over text that was not typed (a pasted path)", async () => {
    let live: Editor | null = null;
    render(<Harness onReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    await act(async () => {
      live!.commands.insertContent("/usr/local/bin");
    });
    expect(slashList()).toBeNull();
  });

  it("stays closed for a typed slash inside a code fence", async () => {
    let live: Editor | null = null;
    render(<Harness onReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    await act(async () => {
      live!.commands.setContent("```\ncode\n```\n", { contentType: "markdown" });
      live!.commands.setTextSelection(2);
      type(live!, "/");
    });
    expect(live!.getText()).toContain("/");
    expect(slashList()).toBeNull();
  });
});

describe("insertMarkdownSlashItem", () => {
  async function withEditor(): Promise<Editor> {
    let live: Editor | null = null;
    render(<Harness onReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    return live!;
  }

  /** Type "/" then replace that range with the picked item. */
  async function insert(editor: Editor, id: MarkdownSlashItemId, options?: { chooseImage?: () => void }) {
    await act(async () => {
      editor.commands.focus("end");
      editor.commands.insertContent("/");
    });
    const to = editor.state.selection.from;
    await act(async () => {
      insertMarkdownSlashItem(editor, { from: to - 1, to }, id, options);
    });
  }

  it("inserts a paragraph", async () => {
    const editor = await withEditor();
    await insert(editor, "paragraph");
    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph");
  });

  it.each([
    ["heading1", 1],
    ["heading2", 2],
    ["heading3", 3],
  ] as const)("inserts %s as heading level %i", async (id, level) => {
    const editor = await withEditor();
    await insert(editor, id);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level } });
  });

  it("inserts a bullet list", async () => {
    const editor = await withEditor();
    await insert(editor, "bulletList");
    expect(editor.isActive("bulletList")).toBe(true);
  });

  it("inserts an ordered list", async () => {
    const editor = await withEditor();
    await insert(editor, "orderedList");
    expect(editor.isActive("orderedList")).toBe(true);
  });

  it("inserts a task list", async () => {
    const editor = await withEditor();
    await insert(editor, "taskList");
    expect(editor.isActive("taskList")).toBe(true);
  });

  it("inserts a blockquote", async () => {
    const editor = await withEditor();
    await insert(editor, "quote");
    expect(editor.isActive("blockquote")).toBe(true);
  });

  it("inserts a code block", async () => {
    const editor = await withEditor();
    await insert(editor, "codeBlock");
    expect(editor.isActive("codeBlock")).toBe(true);
  });

  it("inserts a 3x3 table with a header row", async () => {
    const editor = await withEditor();
    await insert(editor, "table");
    expect(editor.isActive("table")).toBe(true);
    const table = editor.getJSON().content?.find((node) => node.type === "table") as JSONContent | undefined;
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content?.every((cell: JSONContent) => cell.type === "tableHeader")).toBe(true);
  });

  it("inserts a horizontal rule", async () => {
    const editor = await withEditor();
    await insert(editor, "hr");
    expect(editor.getJSON().content?.some((node) => node.type === "horizontalRule")).toBe(true);
  });

  it("inserts a block math node for the formula entry", async () => {
    const editor = await withEditor();
    await insert(editor, "math");
    expect(editor.getJSON().content?.some((node) => node.type === "blockMath")).toBe(true);
  });

  it("inserts a fenced mermaid code block for the diagram entry", async () => {
    const editor = await withEditor();
    await insert(editor, "diagram");
    const fence = editor.getJSON().content?.find((node) => node.type === "codeBlock");
    expect(fence?.attrs?.language).toBe("mermaid");
  });

  it("hands the image entry to the host picker without inserting a node", async () => {
    const editor = await withEditor();
    const chooseImage = vi.fn();
    await insert(editor, "image", { chooseImage });
    expect(chooseImage).toHaveBeenCalledTimes(1);
    expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false);
  });
});
