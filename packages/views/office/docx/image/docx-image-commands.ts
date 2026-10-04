// TipTap glue for the DOCX image layer — the only place that touches the live
// editor. Pure attrs logic lives in ./docx-image-model so tests can cover the
// patch shapes without an editor instance.
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  docxImageAttrsPatch,
  readDocxImageInfo,
  readDocxImageRawContext,
  type DocxImageEdit,
  type DocxImageInfo,
  type DocxImageMime,
} from "./docx-image-model";

export interface DocxImageInsertPayload {
  base64: string;
  mime: DocxImageMime;
  widthPx: number;
  heightPx: number;
  altText?: string;
  label?: string;
}

/**
 * The narrow port the image UI consumes. The concrete implementation is TipTap
 * (`createDocxImageEditing`); view tests inject a fake so components stay
 * editor-free.
 */
export interface DocxImageEditing {
  getSelected(): DocxImageInfo | null;
  subscribe(listener: () => void): () => void;
  /** Insert a new picture at the current selection. False when not editable. */
  insert(payload: DocxImageInsertPayload): boolean;
  /** Apply one inspector edit to the selected image; a no-op without one. */
  apply(edit: DocxImageEdit): void;
  remove(): void;
}

function imageAttrsOf(editor: Editor): Record<string, unknown> | null {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection)) return null;
  if (selection.node.type.name !== "docProtected") return null;
  const attrs = selection.node.attrs as Record<string, unknown>;
  return attrs.blockType === "image" ? attrs : null;
}

export function createDocxImageEditing(getEditor: () => Editor | null): DocxImageEditing {
  return {
    getSelected() {
      const editor = getEditor();
      if (!editor) return null;
      return readDocxImageInfo(imageAttrsOf(editor));
    },
    subscribe(listener) {
      const editor = getEditor();
      if (!editor) return () => undefined;
      editor.on("transaction", listener);
      return () => {
        editor.off("transaction", listener);
      };
    },
    insert(payload) {
      const editor = getEditor();
      if (!editor || !editor.isEditable) return false;
      const genImage: Record<string, unknown> = {
        base64: payload.base64,
        mime: payload.mime,
        widthPx: payload.widthPx,
        heightPx: payload.heightPx,
        ...(payload.altText ? { altText: payload.altText } : {}),
      };
      const node = {
        type: "docProtected",
        attrs: {
          docxIndex: null,
          blockType: "image",
          label: payload.label ?? payload.altText ?? "Picture",
          imageDataUrl: "data:" + payload.mime + ";base64," + payload.base64,
          imageWidthPx: payload.widthPx,
          imageHeightPx: payload.heightPx,
          genImage,
        },
      };
      // A selected node (an existing picture) must not be replaced by the new
      // one: land the insert right after it instead; a text selection inserts
      // at the caret like any other content.
      const insertSelection = editor.state.selection;
      if (insertSelection instanceof NodeSelection) {
        editor.chain().focus().insertContentAt(insertSelection.to, node).run();
      } else {
        editor.chain().focus().insertContent(node).run();
      }
      // Word leaves a text caret after the picture; pasting into an empty
      // document must not leave the image as the only node (a keystroke would
      // replace it). genoffice parity (ribbon-tabs.tsx insertImageFromDataUrl).
      const { doc, selection, schema } = editor.state;
      const $after = doc.resolve(Math.min(selection.to, doc.content.size));
      if (!$after.parent.isTextblock) {
        const chain = editor.chain();
        if ($after.nodeAfter?.isTextblock !== true && schema.nodes.docParagraph) {
          chain.insertContentAt($after.pos, { type: "docParagraph" });
        }
        chain.setTextSelection($after.pos + 1).run();
      }
      return true;
    },
    apply(edit) {
      const editor = getEditor();
      if (!editor || !editor.isEditable) return;
      const attrs = imageAttrsOf(editor);
      if (!attrs) return;
      const patch = docxImageAttrsPatch(readDocxImageRawContext(attrs), edit);
      if (!patch) return;
      editor.chain().focus().updateAttributes("docProtected", patch).run();
    },
    remove() {
      const editor = getEditor();
      if (!editor || !editor.isEditable) return;
      if (!imageAttrsOf(editor)) return;
      editor.chain().focus().deleteSelection().run();
    },
  };
}
