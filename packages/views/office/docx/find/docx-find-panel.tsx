"use client";

import { useCallback, useEffect } from "react";
import { useOfficeDocumentActiveRef } from "../../common/document-active";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { useDocxDocumentScope, useDocxLiveEditor, useDocxScopeValue } from "../editor-store";
import { DocxFindPanel as DocxFindPanelView } from "./find-panel";

/**
 * Chrome slot mounted by docx-editor.tsx: decides when the real find panel is
 * on screen. Visibility and the TipTap editor come from the document scope
 * (../editor-store: the toolbar group lives in another subtree), so the hook
 * order stays stable while either is missing.
 *
 * Escape handling lives here rather than inside the panel: the panel's own
 * keydown listener only sees events that bubble through its subtree, so a
 * keydown on the document (or on the editor surface behind the bar) left the
 * bar open in the real app (visual M-3). While the bar is open this slot owns
 * Escape at the document level and closes it, which is where Word closes Find
 * from too.
 */
export function DocxFindPanel({ readOnly = false }: Pick<DocxToolbarGroupContext, "readOnly">) {
  const scope = useDocxDocumentScope();
  const editor = useDocxLiveEditor();
  const open = useDocxScopeValue(scope.find);
  const activeRef = useOfficeDocumentActiveRef();
  const close = useCallback(() => scope.find.set(false), [scope]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      // A document kept mounted in a hidden desktop tab never claims the key.
      if (event.key !== "Escape" || event.defaultPrevented || !activeRef.current) return;
      event.preventDefault();
      // The bar is a modal-ish layer over the canvas: an open menu/dialog
      // inside it still gets first refusal, so only close when nothing above
      // has already claimed the key.
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, close, activeRef]);

  if (!open || !editor) return null;
  return (
    <div className="relative z-40 h-0" data-testid="docx-find-dock">
      <DocxFindPanelView editor={editor} readOnly={readOnly} onClose={close} />
    </div>
  );
}
