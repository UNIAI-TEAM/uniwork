import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { CellSelection } from "@tiptap/pm/tables";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import { InsertTableGroup, insertTableRibbonItems } from "../toolbar/groups/insert-table";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import type { DocxEditorHandle, DocxSelection } from "../types";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

const editors: Editor[] = [];

const paragraph = (text: string): JSONContent => ({
  type: "docParagraph",
  content: [{ type: "text", text }],
});

const cell = (text: string): JSONContent => ({ type: "docTableCell", content: [paragraph(text)] });

const textDocument: JSONContent = { type: "doc", content: [paragraph("Body")] };

const tableDocument: JSONContent = {
  type: "doc",
  content: [
    paragraph("Before"),
    {
      type: "docTable",
      content: [
        { type: "docTableRow", content: [cell("A1"), cell("B1")] },
        { type: "docTableRow", content: [cell("A2"), cell("B2")] },
      ],
    },
    paragraph("After"),
  ],
};

function createEditor(content: JSONContent, editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content, editable });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function tableOf(editor: Editor): PmNode {
  let table: PmNode | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "docTable") {
      table = node;
      return false;
    }
    return true;
  });
  if (!table) throw new Error("table missing");
  return table;
}

function cellPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "docTableCell" || node.type.name === "docTableHeader") positions.push(pos);
    return true;
  });
  return positions;
}

function rowCellTypes(table: PmNode, row: number): string[] {
  const types: string[] = [];
  table.child(row).forEach((cell) => {
    types.push(cell.type.name);
  });
  return types;
}

function caretInCell(editor: Editor, index = 0): void {
  const pos = cellPositions(editor)[index];
  if (pos === undefined) throw new Error("table cell missing");
  editor.commands.setTextSelection(pos + 1);
}

function selectCells(editor: Editor, anchor: number, head: number): void {
  const from = cellPositions(editor)[anchor];
  const to = cellPositions(editor)[head];
  if (from === undefined || to === undefined) throw new Error("table cells missing");
  editor.view.dispatch(
    editor.state.tr.setSelection(new CellSelection(editor.state.doc.resolve(from), editor.state.doc.resolve(to))),
  );
}

function coordinator(): DocxToolbarGroupContext["coordinator"] {
  const state = {
    state: "dirty" as const,
    identity: {
      deploymentId: "dep",
      accountId: "account",
      organizationId: "org",
      workspaceId: "workspace",
      documentId: "doc",
      generation: 1,
      baseVersionId: "version",
      baseRevision: "1",
    },
    dirtyGeneration: 1,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
  };
}

function makeHandle(editor: Editor): DocxEditorHandle {
  const listeners = new Set<(selection: DocxSelection | null) => void>();
  const readSelection = (): DocxSelection | null => {
    const { from, to } = editor.state.selection;
    return { blockId: null, from, to };
  };
  editor.on("selectionUpdate", () => {
    const next = readSelection();
    for (const listener of listeners) listener(next);
  });
  return {
    format: "docx",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 0,
    captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
    dispose: vi.fn(),
    selection: {
      getSelection: readSelection,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

/** One harness shared by every assertion: the real command runtime over a real
 * docx-schema editor, wired to the group exactly like the toolbar shell does. */
function Harness({ editor, readOnly = false }: { editor: Editor; readOnly?: boolean }) {
  const runtime: DocxCommandRuntime = useMemo(() => createDocxCommandRuntime(() => editor), [editor]);
  const handle = useMemo(() => makeHandle(editor), [editor]);
  const [format, setFormat] = useState(() => runtime.getState());

  useEffect(() => runtime.subscribe(setFormat), [runtime]);
  useEffect(() => {
    const onTransaction = () => runtime.emitState();
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, runtime]);

  const context: DocxToolbarGroupContext = {
    editor: handle,
    coordinator: coordinator(),
    format,
    commands: runtime,
    selection: null,
    readOnly,
    saving: false,
    dirty: false,
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  return <InsertTableGroup {...context} />;
}

const TOOL_TEST_IDS = [
  "docx-table-rows",
  "docx-table-columns",
  "docx-table-merge",
  "docx-table-split",
  "docx-table-header-row",
  "docx-table-repeat-header",
  "docx-table-borders",
  "docx-table-shading",
  "docx-table-delete",
];

describe("InsertTableGroup", () => {
  it("inserts the hovered grid size from the picker", async () => {
    const editor = createEditor(textDocument);
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-table-insert"));
    const target = await screen.findByTestId("docx-table-insert-3x4");
    fireEvent.mouseEnter(target);
    expect(screen.getByTestId("docx-table-insert-size")).toHaveTextContent("3 × 4");

    fireEvent.click(target);
    expect(tableOf(editor).childCount).toBe(3);
    expect(tableOf(editor).firstChild?.childCount).toBe(4);
    await waitFor(() => expect(screen.queryByTestId("docx-table-insert-panel")).toBeNull());
  });

  it("moves the picker highlight with the arrow keys", async () => {
    const editor = createEditor(textDocument);
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-table-insert"));
    const first = await screen.findByTestId("docx-table-insert-1x1");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });

    expect(document.activeElement).toBe(screen.getByTestId("docx-table-insert-2x2"));
    expect(screen.getByTestId("docx-table-insert-size")).toHaveTextContent("2 × 2");
  });

  it("explains that insert is unavailable inside a table", async () => {
    const editor = createEditor(tableDocument);
    caretInCell(editor);
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-table-insert"));
    await screen.findByTestId("docx-table-insert-panel");
    expect(screen.queryByTestId("docx-table-insert-1x1")).toBeNull();
    expect(screen.getByText("Inserting a table inside a table is not available")).toBeInTheDocument();
  });

  it("disables the table tools outside a table and enables them inside one", async () => {
    const textEditor = createEditor(textDocument);
    const { unmount } = render(<Harness editor={textEditor} />);
    for (const testId of TOOL_TEST_IDS) expect(screen.getByTestId(testId)).toBeDisabled();
    unmount();

    const tableEditor = createEditor(tableDocument);
    caretInCell(tableEditor);
    render(<Harness editor={tableEditor} />);
    for (const testId of ["docx-table-rows", "docx-table-columns", "docx-table-header-row", "docx-table-borders", "docx-table-shading", "docx-table-delete"]) {
      expect(screen.getByTestId(testId)).toBeEnabled();
    }
    expect(screen.getByTestId("docx-table-merge")).toBeDisabled();
    expect(screen.getByTestId("docx-table-split")).toBeDisabled();
    expect(screen.getByTestId("docx-table-repeat-header")).toBeEnabled();
  });

  it("enables merge for a cell selection and split for a merged cell", async () => {
    const editor = createEditor(tableDocument);
    selectCells(editor, 0, 1);
    render(<Harness editor={editor} />);

    const merge = screen.getByTestId("docx-table-merge");
    expect(merge).toBeEnabled();
    fireEvent.click(merge);
    expect(tableOf(editor).firstChild?.childCount).toBe(1);

    act(() => caretInCell(editor));
    await waitFor(() => expect(screen.getByTestId("docx-table-split")).toBeEnabled());
    fireEvent.click(screen.getByTestId("docx-table-split"));
    expect(tableOf(editor).firstChild?.childCount).toBe(2);
  });

  it("adds and deletes rows and columns from the menus", async () => {
    const editor = createEditor(tableDocument);
    caretInCell(editor);
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-table-rows"));
    fireEvent.click(await screen.findByTestId("docx-table-row-below"));
    expect(tableOf(editor).childCount).toBe(3);

    fireEvent.click(screen.getByTestId("docx-table-columns"));
    fireEvent.click(await screen.findByTestId("docx-table-column-right"));
    expect(tableOf(editor).firstChild?.childCount).toBe(3);

    fireEvent.click(screen.getByTestId("docx-table-rows"));
    fireEvent.click(await screen.findByTestId("docx-table-row-delete"));
    expect(tableOf(editor).childCount).toBe(2);
  });

  it("toggles the header row and the repeating header rows", async () => {
    const editor = createEditor(tableDocument);
    caretInCell(editor);
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-table-header-row"));
    expect(tableOf(editor).attrs.tblLook).toMatchObject({ firstRow: true });
    expect(rowCellTypes(tableOf(editor), 0)).toEqual(["docTableHeader", "docTableHeader"]);
    expect(rowCellTypes(tableOf(editor), 1)).toEqual(["docTableCell", "docTableCell"]);
    await waitFor(() => expect(screen.getByTestId("docx-table-header-row")).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByTestId("docx-table-repeat-header"));
    expect(tableOf(editor).firstChild?.attrs.repeatHeader).toBe(true);
    await waitFor(() => expect(screen.getByTestId("docx-table-repeat-header")).toHaveAttribute("aria-pressed", "true"));
  });

  it("applies a border preset and a shading swatch to the selected cell", async () => {
    const editor = createEditor(tableDocument);
    caretInCell(editor);
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-table-borders"));
    fireEvent.click(await screen.findByTestId("docx-table-borders-grid"));
    expect(tableOf(editor).firstChild?.firstChild?.attrs.borders).toMatchObject({
      top: { style: "single" },
      bottom: { style: "single" },
    });

    fireEvent.click(screen.getByTestId("docx-table-shading"));
    fireEvent.click(await screen.findByTestId("docx-table-shading-swatch-D9EAF7"));
    expect(tableOf(editor).firstChild?.firstChild?.attrs.fill).toBe("D9EAF7");
  });

  it("disables every control while the document is read-only", () => {
    const editor = createEditor(tableDocument);
    caretInCell(editor);
    render(<Harness editor={editor} readOnly />);

    expect(screen.getByTestId("docx-table-insert")).toBeDisabled();
    for (const testId of TOOL_TEST_IDS) expect(screen.getByTestId(testId)).toBeDisabled();
  });
});

// W-G (UNI-924): the typed ribbon path for the table group. The ribbon renders
// these items instead of the group component; the primary custom item mounts the
// real hover grid picker (8x10, keyboard grid, in-table hint) and the typed
// dropdown mirrors the fixed sizes for a keyboard path.
describe("insertTableRibbonItems", () => {
  function typedContext(runtime: DocxCommandRuntime): DocxToolbarGroupContext {
    return {
      editor: {} as unknown as DocxToolbarGroupContext["editor"],
      coordinator: coordinator(),
      format: runtime.getState(),
      commands: runtime,
      selection: null,
      readOnly: false,
      saving: false,
      dirty: false,
      canUndo: true,
      canRedo: true,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
    };
  }

  it("mounts the hover grid picker as the primary custom item", () => {
    const runtime = createDocxCommandRuntime(() => null);
    const items = insertTableRibbonItems(typedContext(runtime));
    expect(items[0]).toMatchObject({
      kind: "custom",
      id: "insert-table",
      labelKey: "office.docx.table.insert",
    });
    expect(items[1]).toMatchObject({ kind: "dropdown", id: "insert-table-sizes", size: "small" });
  });

  it("routes every grid size through the same insertTable command", () => {
    const runtime = createDocxCommandRuntime(() => null);
    const insertTable = vi.spyOn(runtime, "insertTable");
    const primary = insertTableRibbonItems(typedContext(runtime))[1]!;
    if (primary.kind !== "dropdown") throw new Error("expected a dropdown");
    expect(primary.menu.map((entry) => entry.id)).toEqual([
      "insert-table-2x2",
      "insert-table-3x2",
      "insert-table-3x3",
      "insert-table-4x3",
      "insert-table-4x4",
      "insert-table-5x5",
    ]);
    for (const entry of primary.menu) entry.onSelect();
    expect(insertTable).toHaveBeenCalledWith(2, 2);
    expect(insertTable).toHaveBeenCalledWith(3, 2);
    expect(insertTable).toHaveBeenCalledWith(3, 3);
    expect(insertTable).toHaveBeenCalledWith(4, 3);
    expect(insertTable).toHaveBeenCalledWith(4, 4);
    expect(insertTable).toHaveBeenCalledWith(5, 5);
    expect(insertTable).toHaveBeenCalledTimes(6);
  });

  it("disables the typed size menu while read-only, without a runtime or inside a table", () => {
    const runtime = createDocxCommandRuntime(() => null);
    const readOnly = insertTableRibbonItems({ ...typedContext(runtime), readOnly: true });
    expect(readOnly[1]).toMatchObject({ disabled: true });
    const noRuntime = insertTableRibbonItems({ ...typedContext(runtime), commands: undefined });
    expect(noRuntime[1]).toMatchObject({ disabled: true });
    // Inside a table the command refuses, so the typed menu is disabled and the
    // picker explains instead (its in-table hint).
    const inTable = insertTableRibbonItems({
      ...typedContext(runtime),
      format: { ...runtime.getState(), inTable: true },
    });
    expect(inTable[1]).toMatchObject({ disabled: true });
  });
});
