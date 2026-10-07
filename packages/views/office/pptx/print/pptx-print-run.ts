/**
 * PPTX print run (UNI-952): slides -> print copy -> the INJECTED `OfficePrintPort`.
 *
 * The view never prints the app window. It builds the copy (`buildPptxPrintHtml`) and awaits
 * the host's port - the web browser port or the desktop host port, the same `{ html, title }`
 * shape every Office format uses - and reports its outcome unchanged.
 *
 * A print copy is capped (`PPTX_PRINT_MAX_BYTES`, the desktop IPC cap). The vector copy is
 * tried first; a deck whose pictures push it past the cap is rasterized at decreasing
 * resolutions down to `PPTX_PRINT_RASTER_FLOOR_PX`, and past the floor the run fails with the
 * typed `print_too_large` instead of sending a copy the host would refuse.
 */
import { printPageFromCopy, type OfficePrintOutcome, type OfficePrintPort } from "../../print";
import type { PptxCommandCapability } from "../command-map";
import { buildPptxPrintHtml, type PptxPrintSlide } from "./pptx-print";
import { svgDataUrl } from "../canvas/svg-node";

/** The desktop `desktop:print-document` cap (main's PRINT_HTML_MAX_BYTES). */
export const PPTX_PRINT_MAX_BYTES = 16 * 1024 * 1024;

/** Raster widths tried, in order, when the vector copy is over the cap. The last is the floor:
 *  1200px across a 13.3in page is ~90 dpi, the least that still reads as a slide. */
export const PPTX_PRINT_RASTER_WIDTHS = [2400, 1600, 1200] as const;

/** Draws one slide (`data:` SVG) at `widthPx` and answers a raster `data:` URL, or null. */
export type PptxSlideRasterizer = (svg: string, widthPx: number, heightPx: number) => Promise<string | null>;

interface PptxPrintRunOptions {
  port: OfficePrintPort;
  slides: readonly PptxPrintSlide[];
  title: string;
  /** Raster fallback for an over-cap copy; without one an over-cap copy fails. */
  rasterize?: PptxSlideRasterizer | null;
  /** Copy cap in UTF-8 bytes; defaults to `PPTX_PRINT_MAX_BYTES`. */
  maxBytes?: number;
}

function utf8Bytes(value: string): number {
  return typeof TextEncoder === "undefined" ? value.length : new TextEncoder().encode(value).length;
}

async function rasterCopy(options: PptxPrintRunOptions, widthPx: number): Promise<string | null> {
  const rasterize = options.rasterize!;
  const images: string[] = [];
  for (const slide of options.slides) {
    const heightPx = slide.widthPx > 0 ? Math.round((widthPx * slide.heightPx) / slide.widthPx) : Math.round((widthPx * 9) / 16);
    const image = await rasterize(svgDataUrl(slide.markup), widthPx, heightPx);
    if (!image) return null;
    images.push(image);
  }
  return buildPptxPrintHtml({ slides: options.slides, title: options.title, images });
}

/** The smallest copy that fits the cap: vector first, then each raster width to the floor. */
export async function buildPptxPrintCopy(options: PptxPrintRunOptions): Promise<{ html: string } | { failed: string }> {
  if (options.slides.length === 0) return { failed: "print_empty" };
  const maxBytes = options.maxBytes ?? PPTX_PRINT_MAX_BYTES;
  const vector = buildPptxPrintHtml({ slides: options.slides, title: options.title });
  if (utf8Bytes(vector) <= maxBytes) return { html: vector };
  if (options.rasterize) {
    for (const widthPx of PPTX_PRINT_RASTER_WIDTHS) {
      const html = await rasterCopy(options, widthPx);
      if (html === null) break;
      if (utf8Bytes(html) <= maxBytes) return { html };
    }
  }
  return { failed: "print_too_large" };
}

/** One print run. A port or rasterizer that throws becomes a typed failure, never a crash. */
export async function printPptxDeck(options: PptxPrintRunOptions): Promise<OfficePrintOutcome> {
  try {
    const copy = await buildPptxPrintCopy(options);
    if ("failed" in copy) return { outcome: "failed", reason: copy.failed };
    return await options.port.print({ html: copy.html, title: options.title, page: printPageFromCopy(copy.html) });
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The print/export-pdf capability: no bound port -> hidden with a reason, never a dead control;
 *  while a run builds or prints its copy -> disabled with the "preparing" reason. */
export function pptxPrintCapability(port: OfficePrintPort | null | undefined, reasonKey: string, pending = false): PptxCommandCapability {
  if (!port) return { status: "unavailable", reason: reasonKey, hidden: true };
  return pending ? { status: "unavailable", reason: "office.pptx.reasons.print_preparing" } : { status: "available" };
}
