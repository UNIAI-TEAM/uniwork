import type { PdfSelection } from "../types";

/** A browser-safe reference returned by the host renderer. The view never decodes PNG bytes. */
export interface PdfRenderResult {
  src: string;
  width: number;
  height: number;
}

export interface PdfRenderPageRequest {
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
  signal?: AbortSignal;
}

export interface PdfRenderTileRequest extends PdfRenderPageRequest {
  x: number;
  y: number;
  tileWidth: number;
  tileHeight: number;
}

/** The only rendering capability the shared canvas needs from a host. */
export interface PdfPageRenderService {
  renderPage(request: PdfRenderPageRequest): Promise<PdfRenderResult>;
  renderTile?(request: PdfRenderTileRequest): Promise<PdfRenderResult>;
}

export interface PdfCanvasBox {
  id: string;
  kind: "text" | "image";
  /** Coordinates are in page points with an origin at the top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfCanvasPage {
  pageNumber: number;
  width: number;
  height: number;
  rotation?: number;
  boxes?: readonly PdfCanvasBox[];
}

export type PdfCanvasSelection = PdfSelection;

/** A find-hit highlight: one rectangle in the page's DISPLAY space (origin
 * bottom-left, the /Rotate transform applied) as `[x1, y1, x2, y2]` points. */
export type PdfCanvasHighlightQuad = readonly [number, number, number, number];

/** One find hit painted on a page; `active` marks the hit the find bar is on. */
export interface PdfCanvasHighlight {
  id: string;
  page: number;
  quad: PdfCanvasHighlightQuad;
  active?: boolean;
}

/** What a pointer does on a page: select objects, drag a region, or drop a point. */
export type PdfCanvasTool = "select" | "region" | "point";

/** A rectangle in page points with a top-left origin; a point has zero size. */
export interface PdfCanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
