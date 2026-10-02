"use client";

// UNI-823 F1: the pinned App's note reservations and reference-line page lookup.
// Rendering helpers enter the browser artifact through numbered patch 0006.
import {
  blockNoteScanRuns, cssFontFamily, estimateFootnoteHeight, FOOTNOTE_SEPARATOR_H,
  footnoteLineHeightPx, makeGapNotesEl, measureNoteHeightDom, noteLineHeightPx,
  noteRunStyle, pageAt, resolveNoteStyle,
  type RendererBlock, type RendererBlockBox, type RendererNote,
  type RendererPageNoteItem, type RendererPageSlice, type RendererParsed,
  type RendererSection, type RendererSectionSettings,
} from "@uniwork/office-upstream/docs-renderer-editor";

interface ParsedNotes extends RendererParsed {
  footnotes?: RendererNote[];
  noteNumbers?: Record<string, number>;
}

/** Note text and formatting remain source-owned and read-only. */
export function createDocxFootnotes(parsed: unknown, sections: RendererSection[]) {
  const doc = (parsed ?? { blocks: [] }) as ParsedNotes;
  const notes = doc.footnotes ?? [];
  const cache = new Map<string, RendererPageNoteItem>();
  const noOf = new Map(notes.map((note, i) => [note.id, doc.noteNumbers?.[`footnote:${note.id}`] ?? i + 1]));
  const sectionOf = (index: number) => sections.find((section) => index <= section.lastBlockIndex)?.settings ?? sections[0]?.settings;
  const refsOf = (block: RendererBlock) => blockNoteScanRuns(block).filter((run) => run.noteRef?.kind === "footnote").map((run) => run.noteRef!.id);
  const itemOf = (id: string, settings: RendererSectionSettings): RendererPageNoteItem | undefined => {
    const note = notes.find((entry) => entry.id === id);
    if (!note) return undefined;
    const width = (settings.pageWidth - settings.marginLeft - settings.marginRight) * 96 / 1440;
    const key = `${id}|${width}|${JSON.stringify(settings.docGrid ?? null)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const style = { ...resolveNoteStyle(doc, note.styleId, note.spacing), ...noteRunStyle(note.richParas) };
    const lineHeightPx = noteLineHeightPx(settings.docGrid, style);
    const fontSizePt = style.sizeHalfPoints ? style.sizeHalfPoints / 2 : 10;
    const fontFamily = style.fontFamily ? cssFontFamily(style.fontFamily) : undefined;
    const entry = { no: noOf.get(id) ?? 0, text: note.text, ...(note.richParas ? { richParas: note.richParas } : {}), ...(note.noRefMark ? { noRefMark: true as const } : {}) };
    const height = measureNoteHeightDom(entry, "footnote", width, lineHeightPx, fontSizePt, fontFamily)
      ?? estimateFootnoteHeight(note.text, width, settings.docGrid, undefined, style, note.richParas);
    const item = { ...entry, id, height, lineHeightPx, fontSizePt, ...(fontFamily ? { fontFamily } : {}) };
    cache.set(key, item);
    return item;
  };
  return {
    invalidate: () => cache.clear(),
    bandsOf: (index: number): Array<{ heightPx: number }> => {
      const block = doc.blocks.find((entry) => entry.docxIndex === index);
      const settings = sectionOf(index);
      if (!block || !settings) return [];
      // Keep reference run order, including references in nested table cells.
      return refsOf(block).map((id) => ({ heightPx: itemOf(id, settings)?.height ?? 0 }));
    },
    pageItems: (blocks: RendererBlockBox[], slices: RendererPageSlice[]): RendererPageNoteItem[][] => {
      const result: RendererPageNoteItem[][] = slices.map(() => []);
      for (const block of blocks) {
        if (block.docxIndex === undefined) continue;
        const parsedBlock = doc.blocks.find((entry) => entry.docxIndex === block.docxIndex);
        const settings = sectionOf(block.docxIndex);
        if (!parsedBlock || !settings) continue;
        const ids = refsOf(parsedBlock);
        ids.forEach((id, i) => {
          const item = itemOf(id, settings);
          if (!item) return;
          const band = block.noteBands?.length === ids.length ? block.noteBands[i] : undefined;
          const y = block.top + (band ? (block.spaceBeforePx ?? 0) + band.offset : 0) + 0.5;
          result[pageAt(slices, y) - 1]?.push(item);
        });
      }
      return result;
    },
  };
}

/** Earlier-page notes occupy the top of that page's following gap, like App. */
export function docxGapFootnotes(items: RendererPageNoteItem[], settings: RendererSectionSettings) {
  if (items.length === 0) return { height: 0 };
  const height = items.reduce((sum, item) => sum + item.height, 0) + FOOTNOTE_SEPARATOR_H;
  const width = (settings.pageWidth - settings.marginLeft - settings.marginRight) * 96 / 1440;
  return {
    height,
    notes: makeGapNotesEl(items, settings.marginLeft * 96 / 1440, width, height, footnoteLineHeightPx(settings.docGrid)),
    notesKey: `${Math.round(height)}:${items.map((item) => `${item.id}:${item.no}:${item.text}`).join("|")}`,
  };
}
