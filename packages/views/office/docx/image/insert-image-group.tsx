"use client";

// C9 (UNI-924 T7): the Insert tab's image entry. The floating "Insert image"
// button that used to ride over the canvas is gone (docx-image-layer.tsx keeps
// only the contextual inspector); the insert command lives here, in the ribbon.
//
// The group needs the live TipTap editor to build the image editing port; it
// reads it from its own document's scope (context.docScope, UNI-957), so a
// second DOCX mounted in a hidden desktop tab never receives the picture.
import { useMemo } from "react";
import { createDocxImageEditing } from "./docx-image-commands";
import { DocxImageInsert } from "./docx-image-insert";
import { useDocxScopeValue } from "../editor-store";
import type { DocxToolbarGroupContext } from "../toolbar/types";

/** Insert > Image: pick a file, preview it, then insert it at the caret. */
export function InsertImageGroup({ readOnly = false, saving = false, docScope }: DocxToolbarGroupContext) {
  const editor = useDocxScopeValue(docScope.editor);
  const editing = useMemo(() => (editor ? createDocxImageEditing(() => editor) : null), [editor]);
  if (!editing) return null;
  return <DocxImageInsert editing={editing} readOnly={readOnly || saving} />;
}
