"use client";

import { useSyncExternalStore } from "react";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { getDocxFindEditor, subscribeDocxFindEditor } from "./find-extension";
import { DocxFindPanel as DocxFindPanelView } from "./find-panel";
import { closeDocxFind, isDocxFindOpen, subscribeDocxFind } from "./find-store";

/**
 * Chrome slot mounted by docx-editor.tsx: decides when the real find panel is
 * on screen. Visibility comes from find-store.ts (the toolbar group lives in
 * another subtree) and the TipTap editor from the schema extension's store, so
 * the hook order stays stable while either is missing.
 */
export function DocxFindPanel({ readOnly = false }: Pick<DocxToolbarGroupContext, "readOnly">) {
  const editor = useSyncExternalStore(subscribeDocxFindEditor, getDocxFindEditor, getDocxFindEditor);
  const open = useSyncExternalStore(subscribeDocxFind, isDocxFindOpen, isDocxFindOpen);
  if (!open || !editor) return null;
  return (
    <div className="relative h-0" data-testid="docx-find-dock">
      <DocxFindPanelView editor={editor} readOnly={readOnly} onClose={closeDocxFind} />
    </div>
  );
}
