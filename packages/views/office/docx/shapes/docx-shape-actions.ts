// B9 (UNI-924): TipTap glue for shape insert and the properties panel — the
// only place that touches the live editor. The pure attrs logic lives in
// ./docx-shape-model so tests can cover the patch shapes without an editor.
//
// Insert writes a docProtected node carrying `genXml` + `textboxes`: the
// vendored node view renders the box (and mounts its in-canvas text editor),
// and pmDocToSavePlan turns the node into a { kind: "xml" } row the save bridge
// replays through insert_xml (convert.ts:2007-2068). No save-path change.
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { buildDocxShape, type DocxShapeDisplay, type DocxShapeKind } from "@uniwork/office-engine/docx";
import { docxShapeAttrsPatch, readDocxShapeInfo, type DocxShapeEdit, type DocxShapeInfo } from "./docx-shape-model";

/** A unique wp:docPr id (genoffice ribbon-tabs.tsx:351 mints the same range). */
function mintShapeId(): number {
  return Math.floor(Math.random() * 900000) + 100000;
}

/** The selected protected node when it carries shape textboxes, else null. */
function selectedShapeAttrs(editor: Editor | null): Record<string, unknown> | null {
  if (!editor || editor.isDestroyed) return null;
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection)) return null;
  if (selection.node.type.name !== "docProtected") return null;
  const attrs = selection.node.attrs as Record<string, unknown>;
  return readDocxShapeInfo(attrs) ? attrs : null;
}

/** The selected shape's surface for the panel and the format state. */
export function selectedDocxShape(editor: Editor | null): DocxShapeInfo | null {
  return readDocxShapeInfo(selectedShapeAttrs(editor));
}

/** Insert one basic shape at the current top-level position. False when the
 * document is read-only or the engine refuses the payload. */
export function insertDocxShape(editor: Editor | null, kind: DocxShapeKind, label: string): boolean {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false;
  let built: { xml: string; display: DocxShapeDisplay };
  try {
    built = buildDocxShape({ kind, shapeId: mintShapeId() });
  } catch {
    return false;
  }
  const node = {
    type: "docProtected",
    attrs: {
      docxIndex: null,
      blockType: "passthrough",
      label,
      genXml: built.xml,
      textboxes: [built.display],
    },
  };
  // Top-level insert (genoffice ribbon-tabs.tsx:387-391): a plain insertContent
  // would replace a selected floating node and fails from inside a table cell.
  const { $from } = editor.state.selection;
  const position = $from.depth > 0 ? $from.after(1) : editor.state.selection.to;
  // updateSelection:false keeps the caret where it was; Word does not select a
  // freshly inserted shape, and the Format panel must stay disabled until the
  // user clicks it.
  return editor.chain().focus().insertContentAt(position, node, { updateSelection: false }).run();
}

/** Apply one panel edit to the selected shape. False without a selected shape,
 * on a read-only document, or when the edit cannot apply. */
export function applyDocxShapeEdit(editor: Editor | null, edit: DocxShapeEdit): boolean {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false;
  const attrs = selectedShapeAttrs(editor);
  const patch = docxShapeAttrsPatch(attrs, edit);
  if (!patch) return false;
  return editor.chain().focus().updateAttributes("docProtected", patch).run();
}
