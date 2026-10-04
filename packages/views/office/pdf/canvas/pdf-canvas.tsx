"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { PdfPageCanvas } from "./pdf-page-canvas";
import type { PdfCanvasPage, PdfCanvasRegion, PdfCanvasSelection, PdfCanvasTool, PdfPageRenderService } from "./types";

export interface PdfCanvasProps {
  pages: readonly PdfCanvasPage[];
  renderer: PdfPageRenderService;
  zoom?: number;
  tileSize?: number;
  overscan?: number;
  selection?: PdfCanvasSelection | null;
  onSelectionChange?: (selection: PdfCanvasSelection) => void;
  className?: string;
  tool?: PdfCanvasTool;
  /** Emitted in page points, top-left origin; a point click has zero width and height. */
  onPageRegion?: (pageNumber: number, region: PdfCanvasRegion) => void;
  /** Scrolls the page into view whenever `token` changes (thumbnail click, find hit). */
  focusPage?: { page: number; token: number } | null;
}

const PAGE_GAP = 24;

/** A browser-safe, windowed PDF page surface shared by web and desktop hosts. */
export function PdfCanvas({ pages, renderer, zoom = 1, tileSize, overscan = 1, selection, onSelectionChange, className, tool, onPageRegion, focusPage }: PdfCanvasProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [localSelection, setLocalSelection] = useState<PdfCanvasSelection | null>(selection ?? null);
  const activeSelection = selection === undefined ? localSelection : selection;
  useEffect(() => {
    if (selection !== undefined) setLocalSelection(selection);
  }, [selection]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => setViewportHeight(node.clientHeight || 800);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const dimensions = useMemo(() => pages.map((page) => ({ width: page.width * zoom, height: page.height * zoom, top: 0 })), [pages, zoom]);
  const tops = useMemo(() => {
    let top = PAGE_GAP;
    return dimensions.map((dimension) => {
      const current = top;
      top += dimension.height + PAGE_GAP;
      return { ...dimension, top: current };
    });
  }, [dimensions]);
  const focusToken = focusPage?.token;
  const topsRef = useRef(tops);
  topsRef.current = tops;
  useEffect(() => {
    const target = focusPage?.page;
    if (target === undefined) return;
    const top = topsRef.current[target - 1]?.top;
    if (top !== undefined && scrollRef.current) scrollRef.current.scrollTop = Math.max(0, top - PAGE_GAP);
    // Only a new token scrolls: a later zoom or page change must not pull the view back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);
  const lastTop = tops[tops.length - 1];
  const contentHeight = lastTop ? lastTop.top + lastTop.height + PAGE_GAP : PAGE_GAP;
  // Pages are absolutely positioned, so they do not size the list: give it the
  // widest page plus gutters, or a landscape page wider than the viewport is
  // clipped on the left instead of scrolling.
  const contentWidth = dimensions.reduce((widest, item) => Math.max(widest, item.width), 0) + PAGE_GAP * 2;
  const firstVisible = Math.max(0, tops.findIndex((item) => item.top + item.height >= scrollTop) - overscan);
  const lastVisibleIndex = tops.findIndex((item) => item.top > scrollTop + viewportHeight);
  const lastVisible = Math.min(pages.length, (lastVisibleIndex < 0 ? pages.length : lastVisibleIndex + overscan));
  const onSelect = useCallback((next: PdfCanvasSelection) => {
    if (selection === undefined) setLocalSelection(next);
    onSelectionChange?.(next);
  }, [onSelectionChange, selection]);
  return <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-auto bg-muted/20", className)} aria-label={t("office.pdf.pages.label")} data-testid="pdf-canvas-scroll" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <div className="relative mx-auto" style={{ height: contentHeight, width: contentWidth, minWidth: "100%" }} role="list">
      {pages.slice(firstVisible, lastVisible).map((page, offset) => {
        const index = firstVisible + offset;
        const item = tops[index];
        if (!item) return null;
        return <div key={page.pageNumber} className="absolute left-1/2 -translate-x-1/2" style={{ top: item.top }}><PdfPageCanvas page={page} renderer={renderer} zoom={zoom} tileSize={tileSize} selection={activeSelection} onSelectionChange={onSelect} tool={tool} onPageRegion={onPageRegion} /></div>;
      })}
      {pages.length === 0 ? <p className="p-6 text-center text-caption text-muted-foreground">{t("office.pdf.pages.empty")}</p> : null}
    </div>
  </div>;
}
