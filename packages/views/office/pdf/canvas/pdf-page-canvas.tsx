"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { hitTestPdfBox } from "./hit-test";
import type { PdfCanvasBox, PdfCanvasPage, PdfCanvasRegion, PdfCanvasSelection, PdfCanvasTool, PdfPageRenderService, PdfRenderResult } from "./types";

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


function regionOf(start: { x: number; y: number }, end: { x: number; y: number }): PdfCanvasRegion {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

export function PdfPageCanvas({ page, renderer, zoom, tileSize, selection, onSelectionChange, tool = "select", onPageRegion }: PdfPageCanvasProps) {
  const { t } = useTranslation();
  const pageWidth = page.width * zoom;
  const pageHeight = page.height * zoom;
  const scaledPage = useMemo(() => ({ ...page, boxes: page.boxes?.map((box) => ({ ...box, x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom })) }), [page, zoom]);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<PdfCanvasRegion | null>(null);
  const toPoint = (clientX: number, clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
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
  return <article className="relative bg-background shadow-sm ring-1 ring-border" style={{ width: pageWidth, height: pageHeight }} role="listitem" aria-label={t("office.pdf.selection.page", { page: page.pageNumber })} data-testid={`pdf-page-${page.pageNumber}`} data-tool={annotating ? tool : "select"}>
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
      {draft ? <div aria-hidden className="pointer-events-none absolute border border-primary bg-primary/20" data-testid="pdf-region-draft" style={{ left: draft.x * zoom, top: draft.y * zoom, width: draft.width * zoom, height: draft.height * zoom }} /> : null}
      <div className="pointer-events-none absolute inset-0 z-10"><SelectionOverlay page={scaledPage} selection={selection} onSelectionChange={onSelectionChange} /></div>
    </div>
  </article>;
}
