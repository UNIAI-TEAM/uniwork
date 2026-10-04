"use client";

// C9 (UNI-924 T7): the Insert tab's image entry. The floating "Insert image"
// button that used to ride over the canvas is gone (docx-image-layer.tsx keeps
// only the contextual inspector); the insert command lives here, in the ribbon.
//
// The group needs the live TipTap editor to build the image editing port, and
// the toolbar context carries the host handle only. The lane already publishes
// the live editor through the schema extension's store (find/find-extension.ts)
// for exactly this cross-subtree case, so this group reads that store.
import { useMemo, useSyncExternalStore } from "react";
import { createDocxImageEditing } from "./docx-image-commands";
import { DocxImageInsert } from "./docx-image-insert";
import { getDocxLiveEditor, subscribeDocxLiveEditor } from "../editor-store";
import type { DocxToolbarGroupContext } from "../toolbar/types";

/** Insert > Image: pick a file, preview it, then insert it at the caret. */
export function InsertImageGroup({ readOnly = false, saving = false }: DocxToolbarGroupContext) {
  const editor = useSyncExternalStore(subscribeDocxLiveEditor, getDocxLiveEditor, getDocxLiveEditor);
  const editing = useMemo(() => (editor ? createDocxImageEditing(() => editor) : null), [editor]);
  if (!editing) return null;
  return <DocxImageInsert editing={editing} readOnly={readOnly || saving} />;
}
