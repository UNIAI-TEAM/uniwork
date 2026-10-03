"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { hitTestPdfBox } from "./hit-test";
import type { PdfCanvasBox, PdfCanvasPage, PdfCanvasSelection, PdfPageRenderService, PdfRenderResult } from "./types";

export interface PdfPageCanvasProps {
  page: PdfCanvasPage;
  renderer: PdfPageRenderService;
  zoom: number;
  tileSize?: number;
  selection: PdfCanvasSelection | null;
  onSelectionChange: (selection: PdfCanvasSelection) => void;
}

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

export function PdfPageCanvas({ page, renderer, zoom, tileSize, selection, onSelectionChange }: PdfPageCanvasProps) {
  const { t } = useTranslation();
  const pageWidth = page.width * zoom;
  const pageHeight = page.height * zoom;
  const scaledPage = useMemo(() => ({ ...page, boxes: page.boxes?.map((box) => ({ ...box, x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom })) }), [page, zoom]);
  const selectPage = (clientX: number, clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const x = (clientX - rect.left) / zoom;
    const y = (clientY - rect.top) / zoom;
    const hit = hitTestPdfBox(page.boxes ?? [], x, y);
    onSelectionChange({ page: page.pageNumber, objectId: hit?.id ?? null, kind: hit?.kind ?? "page" });
  };
  return <article className="relative bg-background shadow-sm ring-1 ring-border" style={{ width: pageWidth, height: pageHeight }} role="listitem" aria-label={t("office.pdf.selection.page", { page: page.pageNumber })} data-testid={`pdf-page-${page.pageNumber}`}>
    <PageImage page={page} renderer={renderer} zoom={zoom} tileSize={tileSize} />
    <div className="absolute inset-0">
      <div
        role="button"
        tabIndex={0}
        aria-label={t("office.pdf.selection.background", { page: page.pageNumber })}
        className="absolute inset-0"
        onClick={(event) => selectPage(event.clientX, event.clientY, event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            selectPage(rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
          }
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-10"><SelectionOverlay page={scaledPage} selection={selection} onSelectionChange={onSelectionChange} /></div>
    </div>
  </article>;
}
