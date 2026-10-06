/**
 * PPTX print document (UNI-927 C1).
 *
 * Pure: a deck's rendered slides become one self-contained HTML document with one page per
 * slide, each page the slide's own SVG at the deck's aspect ratio. The browser path
 * (`pptx-export-pdf.ts`) mounts this document in a hidden frame and calls `print()`; the
 * desktop host receives the same HTML through the typed `host:pdf-save` channel. Keeping the
 * document a pure function of the slides means the print output is unit-testable without a
 * DOM or an engine.
 *
 * The page box follows the vendored genoffice slides PDF export: a fixed 7.5in height and a
 * width from the slide ratio (16:9 -> 13.333in, 4:3 -> 10in), so a printed deck and an
 * exported PDF agree on their page geometry.
 */
import { buildSlideSvg } from "../canvas/build-slide-svg";
import type { PptxDeckRenderer } from "../canvas/deck-renderer";
import type { PptxCanvasPalette, PptxImageSize } from "../canvas/paint";
import { slideSvgMarkup } from "../canvas/svg-node";

/** Fixed page height in inches, mirrored from the genoffice slides PDF export. */
export const PPTX_PRINT_HEIGHT_IN = 7.5;

/** Build width of a printed slide. The SVG stays vector and keeps its own viewBox, so this
 *  only bounds the geometry the artifact builds for the page. */
export const PPTX_PRINT_WIDTH = 1280;

export interface PptxPrintSlide {
  /** Slide id, when the caller has one (used for the page id). */
  id?: string;
  /** A standalone SVG document (`slideSvgMarkup`). */
  markup: string;
  widthPx: number;
  heightPx: number;
}

export interface PptxPrintDocument {
  slides: readonly PptxPrintSlide[];
  /** Print document title; the browser uses it as the default file name. */
  title?: string;
}

export interface PptxPrintPageSize {
  widthIn: number;
  heightIn: number;
}

const FALLBACK_RATIO = 16 / 9;
/** Same clamp as the genoffice export: a degenerate ratio must not emit `NaNin` pages. */
const MIN_RATIO = 0.2;
const MAX_RATIO = 5;

/** Page box for a slide: fixed height, width from the slide ratio. A zero, NaN or infinite
 *  size falls back to 16:9 instead of producing a corrupt `@page` rule. */
export function pptxPrintPageSize(widthPx: number, heightPx: number): PptxPrintPageSize {
  const ratio = Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0 ? widthPx / heightPx : FALLBACK_RATIO;
  const safe = Number.isFinite(ratio) && ratio > 0 ? Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO) : FALLBACK_RATIO;
  return { widthIn: Math.round(safe * PPTX_PRINT_HEIGHT_IN * 1000) / 1000, heightIn: PPTX_PRINT_HEIGHT_IN };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Page id of slide `index` (0-based). Stable so an anchor link can target a page. */
export function pptxPrintPageId(index: number): string {
  return `pg${index + 1}`;
}

/** The print stylesheet: one page box per slide, no margins, no browser header/footer. */
export function pptxPrintStyles(page: PptxPrintPageSize): string {
  const width = `${page.widthIn}in`;
  const height = `${page.heightIn}in`;
  return [
    `@page { size: ${width} ${height}; margin: 0; }`,
    "html, body { margin: 0; padding: 0; background: #ffffff; }",
    `.page { position: relative; width: ${width}; height: ${height}; overflow: hidden; page-break-after: always; break-after: page; }`,
    ".page:last-child { page-break-after: auto; break-after: auto; }",
    ".page svg { display: block; width: 100%; height: 100%; }",
  ].join("\n");
}

/**
 * The whole print document: one `.page` per slide, each holding the slide's own SVG. The page
 * box comes from the first slide (a deck has one slide size), so every page shares one `@page`
 * rule; a slide whose own ratio differs still keeps its viewBox and centres inside the box.
 */
export function buildPptxPrintHtml(input: PptxPrintDocument): string {
  const first = input.slides[0];
  const page = pptxPrintPageSize(first?.widthPx ?? 0, first?.heightPx ?? 0);
  const title = input.title?.trim() ? input.title : "";
  const pages = input.slides
    .map((slide, index) => `<div class="page" id="${pptxPrintPageId(index)}"${slide.id ? ` data-slide-id="${escapeHtml(slide.id)}"` : ""}>${slide.markup}</div>`)
    .join("");
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${pptxPrintStyles(page)}</style>`,
    "</head>",
    `<body>${pages}</body>`,
    "</html>",
  ].join("");
}

export interface CollectPptxPrintSlidesOptions {
  /** Canvas palette the on-screen rendition uses, so print colours match the editor. */
  palette: PptxCanvasPalette;
  /** Build width; defaults to `PPTX_PRINT_WIDTH`. */
  widthPx?: number;
  /** Natural pixel size of a data URL (tiled picture/image fills). */
  imageSize?(dataUrl: string): PptxImageSize | undefined;
  /** Accessible name per slide; falls back to `Slide N`. */
  title?(index: number): string | undefined;
}

/**
 * Render every slide of a deck into print slides. A slide the artifact cannot build is skipped
 * (its page is omitted) rather than failing the whole export, matching the rail thumbnail path.
 */
export function collectPptxPrintSlides(renderer: PptxDeckRenderer, options: CollectPptxPrintSlidesOptions): PptxPrintSlide[] {
  const widthPx = options.widthPx ?? PPTX_PRINT_WIDTH;
  const out: PptxPrintSlide[] = [];
  for (let index = 0; index < renderer.slideCount; index += 1) {
    const slide = renderer.buildSlide(index, widthPx);
    if (!slide) continue;
    try {
      const doc = buildSlideSvg(slide, {
        idPrefix: `pptx-print-${index}`,
        palette: options.palette,
        ...(options.imageSize ? { imageSize: options.imageSize } : {}),
      });
      out.push({
        markup: slideSvgMarkup(doc.root, doc, { title: options.title?.(index) ?? `Slide ${index + 1}` }),
        widthPx: doc.widthPx,
        heightPx: doc.heightPx,
      });
    } catch {
      // One unrenderable slide must not lose the rest of the print run.
    }
  }
  return out;
}
