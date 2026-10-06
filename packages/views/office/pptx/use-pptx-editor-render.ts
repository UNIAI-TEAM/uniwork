"use client";

/**
 * The editor's render pipeline (UNI-927 W5): artifact module -> deck renderer ->
 * the selected slide's rendition -> its SVG document, plus the presenter's
 * current/next content built from the SAME renderer. Pulled out of
 * pptx-editor.tsx so the editor stays a composition of hooks.
 */
import { useCallback, useMemo, useRef } from "react";
import { buildSlideSvg, type SlideSvgDocument, type SlideSvgOptions } from "./canvas/build-slide-svg";
import type { PptxCanvasContent } from "./canvas/pptx-canvas-surface";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { usePptxDeckRenderer, usePptxPalette, usePptxRendererModule, useSlideRendition, type PptxDeckRendererInput } from "./canvas/use-canvas-host";
import { presenterNextSlideContent, presenterSlideContent } from "./show";

export interface PptxEditorRenderInput {
  deck: PptxDeckRendererInput | undefined;
  loadRendererModule: () => Promise<PptxRendererModule>;
  idPrefix: string;
  selectedIndex: number;
  fitWidthPx: number;
  presenterOpen: boolean;
}

export function usePptxEditorRender({ deck, loadRendererModule, idPrefix, selectedIndex, fitWidthPx, presenterOpen }: PptxEditorRenderInput) {
  const palette = usePptxPalette();
  const rendererState = usePptxRendererModule(loadRendererModule, deck != null);
  const deckRenderer = usePptxDeckRenderer(rendererState, deck ?? {}, idPrefix, palette);
  const rendition = useSlideRendition(deckRenderer, selectedIndex, fitWidthPx);
  const module = rendererState.status === "ready" ? rendererState.module : null;
  const patternGrid = module?.patternGrid;
  const presetPath = module?.presetPath;
  const presetPolygon = module?.presetPolygon;
  // F10: an inline `imageSize` prop must not rebuild the whole SvgNode tree on every
  // parent render, so it is ref-stabilized the same way the deck renderer stabilizes
  // its own seam. A host that swaps the resolver mid-session bumps `deck.revision`;
  // the ref is written during render (W5 review F6), so the memo that recomputes in
  // that same render reads the new resolver instead of the one an effect has yet to copy.
  const imageSizeRef = useRef(deck?.imageSize);
  imageSizeRef.current = deck?.imageSize;
  const svgOptions = useCallback(
    (prefix: string): SlideSvgOptions => ({
      idPrefix: prefix,
      palette,
      ...(imageSizeRef.current ? { imageSize: imageSizeRef.current } : {}),
      ...(patternGrid ? { patternGrid } : {}),
      ...(presetPath ? { presetPath } : {}),
      ...(presetPolygon ? { presetPolygon } : {}),
    }),
    [palette, patternGrid, presetPath, presetPolygon],
  );
  const svgBuild = useMemo<{ document: SlideSvgDocument | null; error: string | null }>(() => {
    if (!rendition) return { document: null, error: null };
    try {
      return { document: buildSlideSvg(rendition, svgOptions(idPrefix)), error: null };
    } catch (error) {
      // F18: a render tree that builds but cannot be converted to SVG must not crash
      // the editor surface; degrade to the same alert as a failed rendition build.
      return { document: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [idPrefix, rendition, svgOptions]);
  // WIRE-CANVAS-BIND: the presenter shows the SAME rendition the canvas mounts, not the
  // 160px rail thumbnail (P0-2 F6). The next slide is built through the same renderer so
  // the preview is the real tree too.
  const presenterContent = useMemo<PptxCanvasContent | null>(() => presenterSlideContent(svgBuild.document, rendition?.hidden), [rendition?.hidden, svgBuild.document]);
  const presenterNext = useMemo<PptxCanvasContent | null>(
    // Built only while the presenter is open: the editor never pays for a
    // rendition nobody is looking at.
    () => (presenterOpen ? presenterNextSlideContent(deckRenderer, selectedIndex + 1, fitWidthPx, svgOptions(`${idPrefix}-presenter`)) : null),
    [deckRenderer, fitWidthPx, idPrefix, presenterOpen, selectedIndex, svgOptions],
  );
  const building = deck != null && (rendererState.status === "loading" || (rendererState.status === "ready" && !rendition));
  return { palette, rendererState, deckRenderer, rendition, svgBuild, presenterContent, presenterNext, building };
}
