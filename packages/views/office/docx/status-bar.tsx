"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { getDocxLiveEditor, subscribeDocxLiveEditor } from "./editor-store";
import { docxEditorCounts, readDocxPagePosition, type DocxPagePosition } from "./status";
import { DocxStatusBar as DocxStatusBarView } from "./status/status-bar";
import type { DocxToolbarGroupContext } from "./toolbar/types";
import { getDocxZoomController, useDocxEffectiveZoomPercent } from "./view";
import { useDocxViewSurface } from "./view/surface-targets";

/**
 * The document language the bar mirrors. The handle writes the parse's
 * \`docxDocumentLang\` on the editor root; when the mounted surface renders the
 * document under a different root, the first \`[lang]\` inside it carries the same
 * value. The search is deliberately scoped to the document surface: an ancestor
 * lookup would reach \`<html lang>\`, which is the app-shell UI locale, not the
 * document's language. A document that declares neither keeps the unknown mark.
 */
export function readDocumentLang(root: HTMLElement | null, surface: HTMLElement | null): string | null {
  const own = root?.getAttribute("lang");
  if (own && own.trim() !== "") return own;
  const scoped = surface?.querySelector("[lang]")?.getAttribute("lang") ?? null;
  return scoped && scoped.trim() !== "" ? scoped : null;
}

/**
 * Editor-chrome slot: docx-editor.tsx mounts this with the shared toolbar
 * context. The bar is presentational; this adapter feeds it from the surfaces
 * the lane already publishes, so no engine accessor has to be threaded through
 * the handle:
 *
 * - the live TipTap editor (the store the find layer publishes) for the word /
 *   character counts and the document language the handle writes on the root;
 * - the shared zoom controller (view/**) for the zoom mirror and its step
 *   functions (C10's - value + control);
 * - the mounted scroll viewport for the page x/y the pagination driver's
 *   page-gap widgets mark;
 * - the toolbar context's selection for the right-hand selection readout.
 *
 * Nothing here reaches into the save path; a host with no mounted document
 * surface leaves every readout on its unknown mark.
 */
export function DocxStatusBar({ selection, help }: Pick<DocxToolbarGroupContext, "selection"> & { help?: ReactNode }) {
  const live = useSyncExternalStore(subscribeDocxLiveEditor, getDocxLiveEditor, getDocxLiveEditor);
  const surface = useDocxViewSurface();
  const controller = getDocxZoomController();
  const zoom = useDocxEffectiveZoomPercent(controller);
  const [page, setPage] = useState<DocxPagePosition | null>(null);
  // Counts change on every transaction; the revision just re-renders the bar.
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (!live) return undefined;
    const onTransaction = () => setRevision((value) => value + 1);
    live.on("transaction", onTransaction);
    return () => {
      live.off("transaction", onTransaction);
    };
  }, [live]);

  const scrollElement = surface?.scrollElement ?? null;
  const surfaceKey = surface?.key ?? "";
  useEffect(() => {
    if (!scrollElement) {
      setPage(null);
      return undefined;
    }
    const read = () => setPage(readDocxPagePosition(scrollElement));
    read();
    scrollElement.addEventListener("scroll", read, { passive: true });
    return () => scrollElement.removeEventListener("scroll", read);
  }, [scrollElement, surfaceKey]);

  return (
    <DocxStatusBarView
      counts={live ? docxEditorCounts(live) : null}
      page={page}
      language={live ? readDocumentLang(live.view.dom as HTMLElement | null, scrollElement) : null}
      zoom={surface ? zoom : null}
      selection={selection ? { from: selection.from, to: selection.to } : null}
      onZoomIn={surface ? () => controller.zoomIn() : undefined}
      onZoomOut={surface ? () => controller.zoomOut() : undefined}
      onFitWidth={surface ? () => controller.fit("width") : undefined}
      onFitPage={surface ? () => controller.fit("page") : undefined}
      help={help}
    />
  );
}
