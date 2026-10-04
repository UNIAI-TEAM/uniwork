// B9 (UNI-924): the shape command area. Each command is a thin editor-side
// operation (../shapes/docx-shape-actions); the edits ride the normal TipTap
// document → save plan path (genXml rows → insert_xml), so no save channel is
// needed. The format state carries the selected shape's surface for the panel.
import type { Editor } from "@tiptap/core";
import type { DocxShapeKind } from "@uniwork/office-engine/docx";
import { applyDocxShapeEdit, insertDocxShape, selectedDocxShape } from "../shapes/docx-shape-actions";
import type { DocxShapeEdit, DocxShapeInfo } from "../shapes/docx-shape-model";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export interface DocxShapeFormatState {
  /** The selected shape's surface; null when the selection is not a shape. */
  docxShape: DocxShapeInfo | null;
}

export interface DocxShapeCommands {
  /** Insert one basic shape at the current top-level position. */
  insertDocxShape(kind: DocxShapeKind, label: string): boolean;
  /** Apply one format-panel edit to the selected shape. */
  applyDocxShapeEdit(edit: DocxShapeEdit): boolean;
}

export function createShapesCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxShapeCommands, DocxShapeFormatState> {
  const getEditor = (): Editor | null => context.getEditor();
  return {
    commands: {
      insertDocxShape: (kind, label) => insertDocxShape(getEditor(), kind, label),
      applyDocxShapeEdit: (edit) => applyDocxShapeEdit(getEditor(), edit),
    },
    readState: (editor) => ({ docxShape: selectedDocxShape(editor) }),
  };
}
