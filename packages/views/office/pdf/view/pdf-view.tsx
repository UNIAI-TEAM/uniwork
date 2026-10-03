"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RectangleHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PdfCanvas } from "../canvas";
import type { PdfCanvasPage, PdfPageRenderService, PdfRenderResult } from "../canvas";
import type { PdfOutlineItem, PdfViewProps, PdfZoomMode } from "./types";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const THUMBNAIL_WIDTH = 112;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function clampPage(value: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(count, Math.max(1, Math.round(value)));
}

function fitZoom(pages: readonly PdfCanvasPage[], width: number | undefined, height: number | undefined, mode: "fit-width" | "fit-page"): number | null {
  const firstPage = pages[0];
  if (!firstPage || !width || width <= 0) return null;
  const widthZoom = (width - 32) / firstPage.width;
  if (mode === "fit-width" || !height || height <= 0) return clampZoom(widthZoom);
  return clampZoom(Math.min(widthZoom, (height - 32) / firstPage.height));
}

function localLabel(t: ReturnType<typeof useTranslation>["t"], key: string, fallback: string): string {
  return t(key, { defaultValue: fallback });
}

interface ThumbnailProps {
  page: PdfCanvasPage;
  renderer: PdfPageRenderService;
  selected: boolean;
  onSelect: () => void;
}

function Thumbnail({ page, renderer, selected, onSelect }: ThumbnailProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<PdfRenderResult | null>(null);
  const scale = THUMBNAIL_WIDTH / page.width;
  useEffect(() => {
    const controller = new AbortController();
    void renderer.renderPage({ pageNumber: page.pageNumber, width: page.width, height: page.height, scale, signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setResult(next); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [page.height, page.pageNumber, page.width, renderer, scale]);
  return (
    <Button type="button" variant={selected ? "secondary" : "ghost"} size="sm" className="h-auto w-full justify-start p-2" aria-current={selected ? "page" : undefined} aria-label={t("office.pdf.pages.page", { page: page.pageNumber })} onClick={onSelect}>
      <span className="flex w-full flex-col items-center gap-1">
        <span className="relative block w-24 overflow-hidden rounded-sm border border-border bg-background" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
          {result ? <img src={result.src} alt="" className="absolute inset-0 size-full object-contain" draggable={false} /> : <span className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />}
        </span>
        <span className="text-caption">{t("office.pdf.pages.page", { page: page.pageNumber })}</span>
      </span>
    </Button>
  );
}

function Outline({ items, onSelect, level = 0 }: { items: readonly PdfOutlineItem[]; onSelect: (item: PdfOutlineItem) => void; level?: number }) {
  return (
    <>
      {items.map((item) => (
        <div key={item.id} className="space-y-0.5" style={{ paddingInlineStart: `${Math.min(level, 4) * 0.75}rem` }}>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-full justify-start truncate text-left" aria-label={item.title} onClick={() => onSelect(item)}>{item.title}</Button>
          {item.children?.length ? <Outline items={item.children} onSelect={onSelect} level={level + 1} /> : null}
        </div>
      ))}
    </>
  );
}

export function PdfView({ pages, renderer, outline = [], initialZoom = 1, zoom: controlledZoom, currentPage: controlledPage, viewportWidth, viewportHeight, onZoomChange, onPageChange, onOutlineSelect, className }: PdfViewProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLElement>(null);
  const [measuredViewport, setMeasuredViewport] = useState({ width: 0, height: 0 });
  const [localZoom, setLocalZoom] = useState(() => clampZoom(initialZoom));
  const [localPage, setLocalPage] = useState(() => clampPage(controlledPage ?? pages[0]?.pageNumber ?? 1, pages.length));
  const [pageInput, setPageInput] = useState(() => String(controlledPage ?? pages[0]?.pageNumber ?? 1));
  useEffect(() => {
    const node = viewRef.current;
    if (!node) return;
    const measure = () => setMeasuredViewport({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const zoom = clampZoom(controlledZoom ?? localZoom);
  const currentPage = clampPage(controlledPage ?? localPage, pages.length);
  useEffect(() => { setLocalPage(currentPage); setPageInput(String(currentPage)); }, [currentPage]);

  const updateZoom = useCallback((next: number, mode: PdfZoomMode = "manual") => {
    const value = clampZoom(next);
    if (controlledZoom === undefined) setLocalZoom(value);
    onZoomChange?.(value, mode);
  }, [controlledZoom, onZoomChange]);
  const changePage = useCallback((next: number) => {
    const value = clampPage(next, pages.length);
    if (!value) return;
    setLocalPage(value);
    setPageInput(String(value));
    onPageChange?.(value);
  }, [onPageChange, pages.length]);
  const applyPageInput = useCallback(() => {
    const value = Number(pageInput);
    if (Number.isFinite(value)) changePage(value);
    else setPageInput(String(currentPage));
  }, [changePage, currentPage, pageInput]);
  const effectiveViewportWidth = viewportWidth ?? measuredViewport.width;
  const effectiveViewportHeight = viewportHeight ?? measuredViewport.height;
  const fitWidth = useMemo(() => fitZoom(pages, effectiveViewportWidth, effectiveViewportHeight, "fit-width"), [pages, effectiveViewportHeight, effectiveViewportWidth]);
  const fitPage = useMemo(() => fitZoom(pages, effectiveViewportWidth, effectiveViewportHeight, "fit-page"), [pages, effectiveViewportHeight, effectiveViewportWidth]);
  const selectOutline = useCallback((item: PdfOutlineItem) => { changePage(item.page); onOutlineSelect?.(item); }, [changePage, onOutlineSelect]);
  const zoomPercent = Math.round(zoom * 100);
  return (
    <section ref={viewRef} className={cn("flex min-h-0 flex-1 flex-col bg-background", className)} aria-label={t("office.pdf.title")} data-testid="pdf-view">
      <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1" role="toolbar" aria-label={t("office.pdf.toolbar.label")}>
        <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.statusBar.zoomOut")} disabled={zoom <= MIN_ZOOM} onClick={() => updateZoom(zoom - ZOOM_STEP)}><Minus aria-hidden="true" /></Button>
        <span className="min-w-12 text-center text-caption tabular-nums" aria-live="polite">{t("office.pdf.statusBar.zoom", { percent: zoomPercent })}</span>
        <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.statusBar.zoomIn")} disabled={zoom >= MAX_ZOOM} onClick={() => updateZoom(zoom + ZOOM_STEP)}><Plus aria-hidden="true" /></Button>
        <Button type="button" variant="toolbar" size="sm" aria-label={localLabel(t, "office.pdf.view.fitWidth", "Fit width")} disabled={fitWidth === null} onClick={() => { if (fitWidth !== null) updateZoom(fitWidth, "fit-width"); }}><RectangleHorizontal aria-hidden="true" />{localLabel(t, "office.pdf.view.fitWidth", "Fit width")}</Button>
        <Button type="button" variant="toolbar" size="sm" aria-label={localLabel(t, "office.pdf.view.fitPage", "Fit page")} disabled={fitPage === null} onClick={() => { if (fitPage !== null) updateZoom(fitPage, "fit-page"); }}><Maximize2 aria-hidden="true" />{localLabel(t, "office.pdf.view.fitPage", "Fit page")}</Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <label htmlFor="pdf-view-page-input" className="sr-only">{t("office.pdf.statusBar.pageInput")}</label>
        <input id="pdf-view-page-input" className="h-8 w-14 rounded-control border border-input bg-background px-1 text-center text-caption" type="number" min={pages.length ? 1 : 0} max={pages.length || undefined} value={pageInput} onChange={(event) => setPageInput(event.target.value)} onBlur={applyPageInput} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyPageInput(); } }} aria-label={t("office.pdf.statusBar.pageInput")} />
        <span className="text-caption text-muted-foreground">/ {pages.length}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-36 shrink-0 flex-col gap-2 overflow-hidden border-r border-border bg-muted/10 p-2" aria-label={localLabel(t, "office.pdf.view.thumbnails", "Page thumbnails")} data-testid="pdf-thumbnail-rail">
          <h2 className="px-1 text-label font-medium">{localLabel(t, "office.pdf.view.thumbnails", "Page thumbnails")}</h2>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto">{pages.map((page) => <Thumbnail key={page.pageNumber} page={page} renderer={renderer} selected={currentPage === page.pageNumber} onSelect={() => changePage(page.pageNumber)} />)}</div>
        </aside>
        {outline.length ? <aside className="hidden w-52 shrink-0 flex-col gap-2 overflow-auto border-r border-border bg-muted/10 p-2 lg:flex" aria-label={localLabel(t, "office.pdf.view.outline", "Document outline")} data-testid="pdf-outline"><h2 className="px-1 text-label font-medium">{localLabel(t, "office.pdf.view.outline", "Document outline")}</h2><Outline items={outline} onSelect={selectOutline} /></aside> : null}
        <PdfCanvas pages={pages} renderer={renderer} zoom={zoom} className="min-w-0" onSelectionChange={(selection) => { if (selection.page !== currentPage) changePage(selection.page); }} />
      </div>
      <div className="sr-only" role="status" aria-live="polite">{t("office.pdf.surface.page", { page: currentPage, count: pages.length })}</div>
    </section>
  );
}

export type { PdfOutlineItem, PdfViewProps, PdfZoomMode } from "./types";
