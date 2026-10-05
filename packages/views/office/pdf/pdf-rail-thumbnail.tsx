"use client";

import { useEffect, useState } from "react";
import type { PdfCanvasPage, PdfPageRenderService, PdfRenderResult } from "./canvas";

/** Rendered width of a rail thumbnail in CSS px (the rail is w-36 with padding). */
const RAIL_THUMBNAIL_WIDTH = 112;

export interface PdfRailThumbnailProps {
  page: PdfCanvasPage;
  renderer: PdfPageRenderService;
}

/**
 * A small rendered preview of one page for the frame rail. `page` is a fresh
 * object after every edit, so the preview re-renders with the document; until
 * the render lands (or if it fails) a muted box keeps the page's proportions.
 */
export function PdfRailThumbnail({ page, renderer }: PdfRailThumbnailProps) {
  const [result, setResult] = useState<PdfRenderResult | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const scale = RAIL_THUMBNAIL_WIDTH / page.width;
    renderer.renderPage({ pageNumber: page.pageNumber, width: page.width, height: page.height, scale, signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setResult(next); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [page, renderer]);
  return (
    <span
      className="relative block w-full overflow-hidden bg-background shadow-sm ring-1 ring-border"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      data-testid={`pdf-rail-thumbnail-${page.pageNumber}`}
      aria-hidden
    >
      {result ? <img src={result.src} alt="" className="absolute inset-0 size-full object-contain" draggable={false} /> : <span className="absolute inset-0 bg-muted" />}
    </span>
  );
}
