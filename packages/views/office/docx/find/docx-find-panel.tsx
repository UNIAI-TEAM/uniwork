"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { getDocxLiveEditor, subscribeDocxLiveEditor } from "../editor-store";
import { DocxFindPanel as DocxFindPanelView } from "./find-panel";
import { closeDocxFind, isDocxFindOpen, subscribeDocxFind } from "./find-store";

/**
 * Chrome slot mounted by docx-editor.tsx: decides when the real find panel is
 * on screen. Visibility comes from find-store.ts (the toolbar group lives in
 * another subtree) and the TipTap editor from the schema extension's store, so
 * the hook order stays stable while either is missing.
 *
 * Escape handling lives here rather than inside the panel: the panel's own
 * keydown listener only sees events that bubble through its subtree, so a
 * keydown on the document (or on the editor surface behind the bar) left the
 * bar open in the real app (visual M-3). While the bar is open this slot owns
 * Escape at the document level and closes it, which is where Word closes Find
 * from too.
 */
export function DocxFindPanel({ readOnly = false }: Pick<DocxToolbarGroupContext, "readOnly">) {
  const editor = useSyncExternalStore(subscribeDocxLiveEditor, getDocxLiveEditor, getDocxLiveEditor);
  const open = useSyncExternalStore(subscribeDocxFind, isDocxFindOpen, isDocxFindOpen);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      // The bar is a modal-ish layer over the canvas: an open menu/dialog
      // inside it still gets first refusal, so only close when nothing above
      // has already claimed the key.
      closeDocxFind();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  if (!open || !editor) return null;
  return (
    <div className="relative z-40 h-0" data-testid="docx-find-dock">
      <DocxFindPanelView editor={editor} readOnly={readOnly} onClose={closeDocxFind} />
    </div>
  );
}
