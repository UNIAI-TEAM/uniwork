"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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

function RenderedTile({ request, renderer, style }: TileProps) {
  const [result, setResult] = useState<PdfRenderResult | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const renderTile = renderer.renderTile;
    if (!renderTile) return;
    void renderTile({ ...request, signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted && next) setResult(next);
    });
    return () => controller.abort();
  }, [renderer, request]);
  return result ? <img src={result.src} alt="" className="absolute select-none" style={{ ...style, width: `${request.tileWidth * request.scale}px`, height: `${request.tileHeight * request.scale}px` }} draggable={false} /> : null;
}

function PageImage({ page, renderer, zoom, tileSize }: Pick<PdfPageCanvasProps, "page" | "renderer" | "zoom" | "tileSize">) {
  const [result, setResult] = useState<PdfRenderResult | null>(null);
  const useTiles = Boolean(tileSize && tileSize > 0 && renderer.renderTile);
  useEffect(() => {
    if (useTiles) return;
    const controller = new AbortController();
    void renderer.renderPage({ pageNumber: page.pageNumber, width: page.width, height: page.height, scale: zoom, signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted) setResult(next);
    });
    return () => controller.abort();
  }, [page, renderer, useTiles, zoom]);
  if (useTiles) {
    const size = tileSize as number;
    const tiles: ReactNode[] = [];
    for (let y = 0; y < page.height; y += size) {
      for (let x = 0; x < page.width; x += size) {
        const tileWidth = Math.min(size, page.width - x);
        const tileHeight = Math.min(size, page.height - y);
        tiles.push(<RenderedTile key={`${x}:${y}`} renderer={renderer} request={{ pageNumber: page.pageNumber, width: page.width, height: page.height, scale: zoom, x, y, tileWidth, tileHeight }} style={{ left: `${x * zoom}px`, top: `${y * zoom}px` }} />);
      }
    }
    return <>{tiles}</>;
  }
  return result ? <img src={result.src} alt="" className="absolute inset-0 size-full select-none" draggable={false} /> : null;
}

function SelectionOverlay({ page, selection, onSelectionChange }: Pick<PdfPageCanvasProps, "page" | "selection" | "onSelectionChange">) {
  const { t } = useTranslation();
  const boxes = page.boxes ?? [];
  return <>{boxes.map((box) => {
    const selected = selection?.page === page.pageNumber && selection.objectId === box.id;
    return <button key={box.id} type="button" aria-label={t("office.pdf.selection.page", { page: page.pageNumber })} className={cn("absolute rounded-sm border-2 border-transparent bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected && "border-primary ring-2 ring-primary/50")} style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` }} onClick={(event) => { event.stopPropagation(); onSelectionChange({ page: page.pageNumber, objectId: box.id, kind: box.kind }); }} />;
  })}</>;
}

export function PdfPageCanvas({ page, renderer, zoom, tileSize, selection, onSelectionChange }: PdfPageCanvasProps) {
  const { t } = useTranslation();
  const pageWidth = page.width * zoom;
  const pageHeight = page.height * zoom;
  const scaledPage = useMemo(() => ({ ...page, boxes: page.boxes?.map((box) => ({ ...box, x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom })) }), [page, zoom]);
  return <article className="relative bg-background shadow-sm ring-1 ring-border" style={{ width: pageWidth, height: pageHeight }} role="listitem" aria-label={t("office.pdf.selection.page", { page: page.pageNumber })} data-testid={`pdf-page-${page.pageNumber}`} onClick={(event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    const hit = hitTestPdfBox(page.boxes ?? [], x, y);
    onSelectionChange({ page: page.pageNumber, objectId: hit?.id ?? null, kind: hit?.kind ?? "page" });
  }}>
    <PageImage page={page} renderer={renderer} zoom={zoom} tileSize={tileSize} />
    <div className="absolute inset-0"><SelectionOverlay page={scaledPage} selection={selection} onSelectionChange={onSelectionChange} /></div>
  </article>;
}
