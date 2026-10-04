// B5 fix (UNI-924): draft restore must drop stale numbering overlays. The
// restore replays the snapshot's pending edits onto the editor's storage; an
// overlay from an earlier pending state that survives would be picked by a
// later toggle's allocation and restart over the synthetic abstractNumId the
// save oracle refuses (review F2).
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import type { DocxEdit, DocxNumberingDef } from "@uniwork/office-engine/docx";
import { createNumberingCommands } from "../commands/numbering";
import { docxExtensions } from "../docx-schema";
import { listDefsOf, overlayDefForNew, overlayListDef } from "./list-numbering";

const editors: Editor[] = [];

const DEF7: DocxNumberingDef = {
  numId: "7",
  abstractNumId: "0",
  levels: { 0: { numFmt: "decimal", lvlText: "%1." } },
  startOverrides: {},
};

function paragraph(text: string): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 0 }, content: [{ type: "text", text }] };
}

function editorWith(content: JSONContent[], defs: DocxNumberingDef[] = []): Editor {
  const numbering = new Map(defs.map((def) => [def.numId, def]));
  const editor = new Editor({ extensions: docxExtensions(numbering), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

function areaFor(editor: Editor) {
  return createNumberingCommands({ getEditor: () => editor });
}

/** The ops a save would replay onto the session model. */
function appliedOps(area: ReturnType<typeof areaFor>): unknown[] {
  const ops: unknown[] = [];
  const edit = (_ref: string, op: DocxEdit): { applied: true; revision: number } => {
    ops.push(op);
    return { applied: true, revision: ops.length };
  };
  area.commands.applyDocxNumberingEdits({ edit }, "ref");
  return ops;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("restoreDocxNumberingEdits", () => {
  it("drops a stale overlay so a later toggle inserts a definition, not a pending restart", () => {
    const editor = editorWith([paragraph("one")]);
    const area = areaFor(editor);
    // A previous pending state left this overlay behind.
    overlayListDef(editor, overlayDefForNew({ numId: "3", kind: "bullet" }));
    expect([...listDefsOf(editor).keys()]).toEqual(["3"]);

    area.commands.restoreDocxNumberingEdits(undefined);
    expect([...listDefsOf(editor).keys()]).toEqual([]);

    editor.commands.setTextSelection(2);
    area.commands.toggleList("bullet");
    expect(appliedOps(area)).toEqual([{ op: "insert_numbering_def", def: { numId: "3", kind: "bullet" } }]);
  });

  it("keeps the parse's own definitions and the restored snapshot's overlays, dropping the rest", () => {
    const editor = editorWith([paragraph("one")], [DEF7]);
    const area = areaFor(editor);
    editor.commands.setTextSelection(2);
    area.commands.toggleList("ordered"); // restart num 8 over DEF7's abstractNum 0
    overlayListDef(editor, overlayDefForNew({ numId: "9", kind: "ordered" }));
    const snapshot = area.commands.listDocxNumberingEdits();
    expect(snapshot.restartNums).toHaveLength(1);

    area.commands.restoreDocxNumberingEdits(snapshot);
    expect([...listDefsOf(editor).keys()].sort()).toEqual(["7", "8"]);
    expect(listDefsOf(editor).get("8")).toMatchObject({ abstractNumId: "0" });
  });

  it("re-overlays a restored snapshot's pending definition", () => {
    const editor = editorWith([paragraph("one")]);
    const area = areaFor(editor);
    editor.commands.setTextSelection(2);
    area.commands.toggleList("ordered");
    const snapshot = area.commands.listDocxNumberingEdits();
    area.commands.restoreDocxNumberingEdits(undefined);
    expect([...listDefsOf(editor).keys()]).toEqual([]);

    area.commands.restoreDocxNumberingEdits(snapshot);
    expect([...listDefsOf(editor).keys()]).toEqual(["3"]);
    expect(listDefsOf(editor).get("3")).toMatchObject({ abstractNumId: "pending-3" });
  });
});
