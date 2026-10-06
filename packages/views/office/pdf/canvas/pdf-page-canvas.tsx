"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { hitTestPdfBox } from "./hit-test";
import type { PdfCanvasBox, PdfCanvasHighlight, PdfCanvasPage, PdfCanvasRegion, PdfCanvasSelection, PdfCanvasTool, PdfPageRenderService, PdfRenderResult } from "./types";

export interface PdfPageCanvasProps {
  page: PdfCanvasPage;
  renderer: PdfPageRenderService;
  zoom: number;
  tileSize?: number;
  selection: PdfCanvasSelection | null;
  onSelectionChange: (selection: PdfCanvasSelection) => void;
  /** `select` (default) picks objects; `region` drags a rectangle; `point` drops a point. */
  tool?: PdfCanvasTool;
  onPageRegion?: (pageNumber: number, region: PdfCanvasRegion) => void;
  /** Find-hit rectangles for this page, in the page's DISPLAY space (the /Rotate
   * transform already applied), origin bottom-left, in the same units as
   * `page.width` / `page.height`. */
  highlights?: readonly PdfCanvasHighlight[];
}

/** Smallest dragged region (points) that counts as a region rather than a stray click. */
const MIN_REGION = 3;
/** Region emitted by the keyboard path (Enter on the page), centred on the page. */
const KEYBOARD_REGION = { width: 160, height: 20 };

interface TileProps {
  request: Parameters<NonNullable<PdfPageRenderService["renderTile"]>>[0];
  renderer: PdfPageRenderService;
  style: CSSProperties;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function reportRenderError(kind: "page" | "tile", error: unknown, signal: AbortSignal): void {
  if (signal.aborted || isAbortError(error)) return;
  console.error(`PDF ${kind} render failed`, error);
}

function RenderedTile({ request, renderer, style }: TileProps) {
  const [result, setResult] = useState<PdfRenderResult | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const renderTile = renderer.renderTile;
    if (!renderTile) return;
    void renderTile({ ...request, signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted && next) setResult(next);
    }).catch((error: unknown) => reportRenderError("tile", error, controller.signal));
    return () => controller.abort();
  }, [renderer, request]);
  return result ? <img src={result.src} alt="" className="absolute select-none" style={{ ...style, width: `${request.tileWidth * request.scale}px`, height: `${request.tileHeight * request.scale}px` }} draggable={false} /> : null;
}

function PageImage({ page, renderer, zoom, tileSize }: Pick<PdfPageCanvasProps, "page" | "renderer" | "zoom" | "tileSize">) {
  const [result, setResult] = useState<PdfRenderResult | null>(null);
  const useTiles = Boolean(tileSize && tileSize > 0 && renderer.renderTile);
  const size = tileSize ?? 0;
  const tiles = useMemo(() => {
    if (!useTiles || size <= 0) return [];
    const requests: Array<{ request: Parameters<NonNullable<PdfPageRenderService["renderTile"]>>[0]; style: CSSProperties }> = [];
    for (let y = 0; y < page.height; y += size) {
      for (let x = 0; x < page.width; x += size) {
        const tileWidth = Math.min(size, page.width - x);
        const tileHeight = Math.min(size, page.height - y);
        requests.push({
          request: { pageNumber: page.pageNumber, width: page.width, height: page.height, scale: zoom, x, y, tileWidth, tileHeight },
          style: { left: `${x * zoom}px`, top: `${y * zoom}px` },
        });
      }
    }
    return requests;
  }, [page.height, page.pageNumber, page.width, size, useTiles, zoom]);
  useEffect(() => {
    if (useTiles) return;
    const controller = new AbortController();
    void renderer.renderPage({ pageNumber: page.pageNumber, width: page.width, height: page.height, scale: zoom, signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted) setResult(next);
    }).catch((error: unknown) => reportRenderError("page", error, controller.signal));
    return () => controller.abort();
  }, [page, renderer, useTiles, zoom]);
  if (useTiles) {
    return <>{tiles.map(({ request, style }) => <RenderedTile key={`${request.x}:${request.y}`} renderer={renderer} request={request} style={style} />)}</>;
  }
  return result ? <img src={result.src} alt="" className="absolute inset-0 size-full select-none" draggable={false} /> : null;
}

function SelectionOverlay({ page, selection, onSelectionChange }: Pick<PdfPageCanvasProps, "page" | "selection" | "onSelectionChange">) {
  const { t } = useTranslation();
  const boxes = page.boxes ?? [];
  return <>{boxes.map((box) => {
    const selected = selection?.page === page.pageNumber && selection.objectId === box.id;
    return <button key={box.id} type="button" aria-label={t("office.pdf.selection.page", { page: page.pageNumber })} className={cn("pointer-events-auto absolute rounded-sm border-2 border-transparent bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected && "border-primary ring-2 ring-primary/50")} style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` }} onClick={(event) => { event.stopPropagation(); onSelectionChange({ page: page.pageNumber, objectId: box.id, kind: box.kind }); }} />;
  })}</>;
}


/** Find-hit highlights for one page: quads are already in the page's DISPLAY
 * space (bottom-left origin), the same space as the raster and the reported page
 * size, so they map straight to the canvas's top-left display points without a
 * second rotation. Visual only. */
function HighlightOverlay({ page, highlights }: { page: PdfCanvasPage; highlights: readonly PdfCanvasHighlight[] }) {
  return <>{highlights.map((highlight) => {
    const [x1, y1, x2, y2] = highlight.quad;
    const left = Math.min(x1, x2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    // PDF display space is bottom-left; the canvas is top-left: top = height - y2.
    const region = { x: left, y: page.height - Math.max(y1, y2), width, height };
    const active = highlight.active === true;
    return <div key={highlight.id} aria-hidden data-testid={`pdf-find-highlight-${highlight.id}`} data-active={active} className={cn("pointer-events-none absolute rounded-sm", active ? "bg-warning/30 ring-2 ring-warning" : "bg-warning/20")} style={{ left: `${region.x}px`, top: `${region.y}px`, width: `${region.width}px`, height: `${region.height}px` }} />;
  })}</>;
}

function regionOf(start: { x: number; y: number }, end: { x: number; y: number }): PdfCanvasRegion {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

/** Quarter turns clockwise for a page rotation; 0/90/180/270 map to 0/1/2/3.
 * Only the legacy page-own-size layout path uses this (see `PdfCanvasPage`);
 * rotation 0, what both hosts report, makes every helper below an identity. */
function quarterTurns(rotation: number | undefined): number {
  return ((Math.round((rotation ?? 0) / 90) % 4) + 4) % 4;
}

/** Display (rotated) point -> page-own point: the inverse of the clockwise display map. */
function toPagePoint(point: { x: number; y: number }, width: number, height: number, turns: number): { x: number; y: number } {
  switch (turns) {
    case 1: return { x: point.y, y: height - point.x };
    case 2: return { x: width - point.x, y: height - point.y };
    case 3: return { x: width - point.y, y: point.x };
    default: return { x: point.x, y: point.y };
  }
}

/** Page-own rect -> display (rotated) rect, so overlays follow the rendered rotation. */
function toDisplayRegion(region: PdfCanvasRegion, width: number, height: number, turns: number): PdfCanvasRegion {
  switch (turns) {
    case 1: return { x: height - region.y - region.height, y: region.x, width: region.height, height: region.width };
    case 2: return { x: width - region.x - region.width, y: height - region.y - region.height, width: region.width, height: region.height };
    case 3: return { x: region.y, y: width - region.x - region.width, width: region.height, height: region.width };
    default: return region;
  }
}

export function PdfPageCanvas({ page, renderer, zoom, tileSize, selection, onSelectionChange, tool = "select", onPageRegion, highlights }: PdfPageCanvasProps) {
  const { t } = useTranslation();
  const turns = quarterTurns(page.rotation);
  const pageWidth = (turns % 2 === 1 ? page.height : page.width) * zoom;
  const pageHeight = (turns % 2 === 1 ? page.width : page.height) * zoom;
  const scaledPage = useMemo(() => ({ ...page, boxes: page.boxes?.map((box) => ({ ...box, ...toDisplayRegion({ x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom }, page.width * zoom, page.height * zoom, turns) })) }), [page, zoom, turns]);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<PdfCanvasRegion | null>(null);
  const toPoint = (clientX: number, clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    return toPagePoint({ x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }, page.width, page.height, turns);
  };
  const selectPage = (clientX: number, clientY: number, target: HTMLElement) => {
    const { x, y } = toPoint(clientX, clientY, target);
    const hit = hitTestPdfBox(page.boxes ?? [], x, y);
    onSelectionChange({ page: page.pageNumber, objectId: hit?.id ?? null, kind: hit?.kind ?? "page" });
  };
  const annotating = tool !== "select" && onPageRegion !== undefined;
  const finishDrag = (clientX: number, clientY: number, target: HTMLElement) => {
    const start = dragStart.current;
    dragStart.current = null;
    setDraft(null);
    if (!start || !onPageRegion) return;
    const region = regionOf(start, toPoint(clientX, clientY, target));
    if (region.width >= MIN_REGION && region.height >= MIN_REGION) onPageRegion(page.pageNumber, region);
  };
  const keyboardActivate = (target: HTMLElement) => {
    if (!annotating) {
      const rect = target.getBoundingClientRect();
      selectPage(rect.left + rect.width / 2, rect.top + rect.height / 2, target);
      return;
    }
    const width = tool === "region" ? Math.min(KEYBOARD_REGION.width, page.width) : 0;
    const height = tool === "region" ? Math.min(KEYBOARD_REGION.height, page.height) : 0;
    onPageRegion?.(page.pageNumber, { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height });
  };
  const displayDraft = draft ? toDisplayRegion(draft, page.width, page.height, turns) : null;
  return <article className="relative bg-background shadow-[var(--floating-shadow)] ring-1 ring-border" style={{ width: pageWidth, height: pageHeight }} role="listitem" aria-label={t("office.pdf.selection.page", { page: page.pageNumber })} data-testid={`pdf-page-${page.pageNumber}`} data-tool={annotating ? tool : "select"}>
    <PageImage page={page} renderer={renderer} zoom={zoom} tileSize={tileSize} />
    <div className="absolute inset-0">
      <div
        role="button"
        tabIndex={0}
        aria-label={t("office.pdf.selection.background", { page: page.pageNumber })}
        className={cn("absolute inset-0", annotating && "cursor-crosshair touch-none")}
        onClick={(event) => {
          if (!annotating) selectPage(event.clientX, event.clientY, event.currentTarget);
          else if (tool === "point") onPageRegion?.(page.pageNumber, { ...toPoint(event.clientX, event.clientY, event.currentTarget), width: 0, height: 0 });
        }}
        onPointerDown={(event) => {
          if (!annotating || tool !== "region") return;
          dragStart.current = toPoint(event.clientX, event.clientY, event.currentTarget);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragStart.current) setDraft(regionOf(dragStart.current, toPoint(event.clientX, event.clientY, event.currentTarget)));
        }}
        onPointerUp={(event) => finishDrag(event.clientX, event.clientY, event.currentTarget)}
        onPointerCancel={() => { dragStart.current = null; setDraft(null); }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          keyboardActivate(event.currentTarget);
        }}
      />
      {displayDraft ? <div aria-hidden className="pointer-events-none absolute border border-primary bg-primary/20" data-testid="pdf-region-draft" style={{ left: displayDraft.x * zoom, top: displayDraft.y * zoom, width: displayDraft.width * zoom, height: displayDraft.height * zoom }} /> : null}
      <div className="pointer-events-none absolute inset-0" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }} data-testid={`pdf-find-highlights-${page.pageNumber}`}><HighlightOverlay page={page} highlights={highlights ?? []} /></div>
      <div className="pointer-events-none absolute inset-0 z-10"><SelectionOverlay page={scaledPage} selection={selection} onSelectionChange={onSelectionChange} /></div>
    </div>
  </article>;
}
