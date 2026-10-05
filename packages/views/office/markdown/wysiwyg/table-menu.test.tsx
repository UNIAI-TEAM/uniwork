// @vitest-environment jsdom
import { useEffect, useRef, useState } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { MarkdownWysiwygEditor } from "./editor";
import { MarkdownTableMenu } from "./table-menu";
import {
  MARKDOWN_TABLE_MENU_ACTIONS,
  findTablePosition,
  isMarkdownTableMenuVisible,
  type MarkdownTableMenuActionId,
} from "./table-menu-items";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

/**
 * The table must be PADDED (the shape the M1 kitchen-sink fixture uses). M1
 * keeps a table whose serialisation the manager would re-pad as an opaque
 * `markdownRaw` node, so an unpadded `| a | b |` source is deliberately not a
 * table node and carries no table context toolbar - that is the byte-identity
 * contract, not a gap in this menu.
 */
const TABLE_FIXTURE = ["# Title", "", "| col a | col b |", "| ----- | ----- |", "| 1     | 2     |", ""].join("\n");
const PLAIN_FIXTURE = "# Title\n\nBody paragraph.\n";

function createHandle(initial: string): TextEditorHandle {
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

/** The live M1 editor plus the M3 table toolbar, wired as the surface does. */
function Harness({
  text,
  editable = true,
  onReady,
}: {
  text: string;
  editable?: boolean;
  onReady?: (editor: Editor | null) => void;
}) {
  const [handle] = useState(() => createHandle(text));
  const [instance, setInstance] = useState<Editor | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    readyRef.current?.(instance);
  }, [instance]);
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} editable={editable} onEditorReady={setInstance} showRibbon={false} />
      <MarkdownTableMenu editor={instance} />
    </div>
  );
}

async function mount(text: string, editable = true): Promise<Editor> {
  let live: Editor | null = null;
  render(<Harness text={text} editable={editable} onReady={(editor) => { live = editor; }} />);
  await waitFor(() => expect(live).not.toBeNull());
  return live!;
}

/** Park the cursor inside the document's first table cell. */
function selectFirstTableCell(editor: Editor): void {
  let inside = -1;
  editor.state.doc.descendants((node, pos) => {
    if (inside === -1 && node.type.name === "tableCell") {
      inside = pos + 2;
      return false;
    }
    return true;
  });
  expect(inside).toBeGreaterThan(0);
  act(() => {
    editor.commands.setTextSelection(inside);
  });
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="md-table-menu"]');
}

describe("table menu visibility", () => {
  it("is hidden when the selection is outside a table", async () => {
    const editor = await mount(PLAIN_FIXTURE);
    act(() => {
      editor.commands.focus("start");
    });
    expect(isMarkdownTableMenuVisible(editor)).toBe(false);
    expect(menu()).toBeNull();
  });

  it("appears only once the selection sits inside a table", async () => {
    const editor = await mount(TABLE_FIXTURE);
    // Cursor starts in the heading: no toolbar.
    expect(menu()).toBeNull();
    selectFirstTableCell(editor);
    await waitFor(() => expect(menu()).not.toBeNull());
    expect(isMarkdownTableMenuVisible(editor)).toBe(true);
  });

  it("is not offered in a read-only document", async () => {
    const editor = await mount(TABLE_FIXTURE, false);
    selectFirstTableCell(editor);
    await waitFor(() => expect(isMarkdownTableMenuVisible(editor)).toBe(false));
    expect(menu()).toBeNull();
  });

  it("reports the table's document position for the anchor", async () => {
    const editor = await mount(TABLE_FIXTURE);
    expect(findTablePosition(editor)).toBeNull();
    selectFirstTableCell(editor);
    await waitFor(() => expect(findTablePosition(editor)).toBeGreaterThan(0));
  });
});

describe("table menu actions", () => {
  it("offers exactly the eight commands the brief names", () => {
    const ids = MARKDOWN_TABLE_MENU_ACTIONS.map((action) => action.id);
    expect(ids).toEqual<MarkdownTableMenuActionId[]>([
      "addRowBefore", "addRowAfter", "addColumnBefore", "addColumnAfter",
      "deleteRow", "deleteColumn", "toggleHeaderRow", "deleteTable",
    ]);
    for (const action of MARKDOWN_TABLE_MENU_ACTIONS) {
      expect(action.labelKey).toBe(`office.markdown.table.${action.id}`);
    }
  });

  /** Click one toolbar button on a freshly mounted table editor. */
  async function clickAction(id: MarkdownTableMenuActionId): Promise<Editor> {
    const editor = await mount(TABLE_FIXTURE);
    selectFirstTableCell(editor);
    const button = await waitFor(() => {
      const found = menu()?.querySelector<HTMLElement>(`[data-table-action="${id}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    await act(async () => {
      fireEvent.click(button);
    });
    return editor;
  }

  function tableOf(editor: Editor): JSONContent | undefined {
    return editor.getJSON().content?.find((node) => node.type === "table") as JSONContent | undefined;
  }

  it("adds a row above", async () => {
    const editor = await clickAction("addRowBefore");
    expect(tableOf(editor)?.content).toHaveLength(3);
  });

  it("adds a row below", async () => {
    const editor = await clickAction("addRowAfter");
    expect(tableOf(editor)?.content).toHaveLength(3);
  });

  it("adds a column to the left", async () => {
    const editor = await clickAction("addColumnBefore");
    expect(tableOf(editor)?.content?.[0]?.content).toHaveLength(3);
  });

  it("adds a column to the right", async () => {
    const editor = await clickAction("addColumnAfter");
    expect(tableOf(editor)?.content?.[0]?.content).toHaveLength(3);
  });

  it("deletes the current row", async () => {
    const editor = await clickAction("deleteRow");
    expect(tableOf(editor)?.content).toHaveLength(1);
  });

  it("deletes the current column", async () => {
    const editor = await clickAction("deleteColumn");
    expect(tableOf(editor)?.content?.[0]?.content).toHaveLength(1);
  });

  it("toggles the header row off and back on", async () => {
    const editor = await clickAction("toggleHeaderRow");
    expect(tableOf(editor)?.content?.[0]?.content?.[0]?.type).toBe("tableCell");
    // The toolbar is still offered, so the same command turns it back on.
    const button = await waitFor(() => {
      const found = menu()?.querySelector<HTMLElement>('[data-table-action="toggleHeaderRow"]');
      expect(found).not.toBeNull();
      return found!;
    });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(tableOf(editor)?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
  });

  it("deletes the whole table and hides the toolbar", async () => {
    const editor = await clickAction("deleteTable");
    expect(tableOf(editor)).toBeUndefined();
    await waitFor(() => expect(menu()).toBeNull());
  });
});
