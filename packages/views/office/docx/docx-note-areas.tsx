"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { endnotesAnchorY, PageEndnotes, PageFootnotes, type RendererNote, type RendererParsed } from "@uniwork/office-upstream/docs-renderer-editor";
import { docxZoomFactorOf } from "./view/zoom-factor";

const noEdit = () => {};

/** Notes are source-owned display content. Saving continues to preserve their parts. */
export function DocxNoteAreas({ editor, parsed }: { editor: Editor; parsed: RendererParsed }) {
  const notes = parsed as RendererParsed & { footnotes?: RendererNote[]; endnotes?: RendererNote[]; noteNumbers?: Record<string, number> };
  const [top, setTop] = useState<number | null>(null);
  const [gapNoteIds, setGapNoteIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const measure = () => {
      // The session can destroy the editor before React unmounts this area.
      if (disposed || editor.isDestroyed) return;
      const pm = editor.view.dom;
      setGapNoteIds(new Set(Array.from(pm.querySelectorAll<HTMLElement>(".page-gap-note[data-note-id]")).map((row) => row.dataset.noteId as string)));
      const wrap = pm.closest(".page-wrap");
      // The anchor is layout px: divide the CSS `zoom` scale out of the rects
      // (same factor the pagination driver measures with).
      if (wrap) setTop(endnotesAnchorY(pm, wrap.getBoundingClientRect().top, docxZoomFactorOf(pm.closest<HTMLElement>(".doc-zoom"))));
    };
    // Run after the host pagination frame, including font and editing reflow.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(measure); });
    };
    editor.on("transaction", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      editor.off("transaction", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [editor]);
  const numberOf = (kind: "footnote" | "endnote") => (note: RendererNote, index: number) => notes.noteNumbers?.[`${kind}:${note.id}`] ?? index + 1;
  return <>
    <PageFootnotes notes={notes.footnotes ?? []} skipIds={gapNoteIds} numberOf={numberOf("footnote")} readOnly onEdit={noEdit} onDelete={noEdit} />
    <PageEndnotes notes={notes.endnotes ?? []} top={top} numberOf={numberOf("endnote")} readOnly onEdit={noEdit} onDelete={noEdit} />
  </>;
}
