// Lab-only candidate (slice core-xlsx-pdf, Advisor decision g117 option (a)): the missing
// pdfApi.pageImagePng capability for the DOC-003 lab host.
//
// The upstream renderer consumes this call as a Promise<base64 PNG string>:
//   window.pdfApi.pageImagePng({ path, pageIndex, rect, scale }).catch(() => null)
//   -> data:image/png;base64,<b64>   (apps/pdf renderer: bakeSourcePng / crop / cutout / replace)
//
// This module renders the requested rectangle of the requested page with the REAL render path
// present in the prepared source tree - pdfjs-dist 6.2.108 plus @napi-rs/canvas 1.0.3, the same
// dependency pair the product main process uses for this call. There is no stub image, no cached
// oracle bytes and no fabricated success: an unusable request is refused by name.
//
// Node 22 built-ins plus the prepared source dependencies only. No product imports.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PAGE_IMAGE_PNG_CHANNEL = 'host:pdf-page-image-png';

export class PageImagePngError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PageImagePngError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function loadRenderDeps(sourceRoot) {
  const require = createRequire(join(sourceRoot, 'package.json'));
  const pdfjsEntry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const canvasEntry = require.resolve('@napi-rs/canvas');
  return {
    pdfjs: import(pathToFileURL(pdfjsEntry).href),
    canvas: import(pathToFileURL(canvasEntry).href),
  };
}

export function createPageImagePngHandler({ sourceRoot } = {}) {
  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) {
    throw new PageImagePngError('no_source_root', 'the lab pageImagePng channel needs the prepared source root');
  }
  const deps = loadRenderDeps(sourceRoot);
  return async function pageImagePng(request) {
    if (!request || typeof request !== 'object' || typeof request.path !== 'string' || request.path.length === 0) {
      throw new PageImagePngError('bad_input', 'pageImagePng needs { path, pageIndex, rect, scale }');
    }
    const rect = Array.isArray(request.rect) ? request.rect.map(Number) : null;
    if (!rect || rect.length !== 4 || !rect.every(isFiniteNumber) || rect[2] <= rect[0] || rect[3] <= rect[1]) {
      throw new PageImagePngError('bad_input', 'rect must be four finite numbers [x0, y0, x1, y1] with x1 > x0 and y1 > y0', { rect: request.rect === undefined ? null : request.rect });
    }
    const pageIndex = Number(request.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      throw new PageImagePngError('bad_page_index', 'pageIndex must be a non-negative integer', { pageIndex: request.pageIndex === undefined ? null : request.pageIndex });
    }
    const requestedScale = Number(request.scale);
    const scale = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
    let bytes;
    try {
      bytes = readFileSync(request.path);
    } catch (error) {
      throw new PageImagePngError('bad_input', 'pageImagePng cannot read ' + request.path + ': ' + String(error && error.message ? error.message : error));
    }
    if (!bytes || bytes.length === 0) throw new PageImagePngError('bad_input', 'the PDF bytes are empty');
    const pdfjs = await deps.pdfjs;
    const canvasModule = await deps.canvas;
    const createCanvas = canvasModule.createCanvas;
    let doc = null;
    try {
      doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false, useSystemFonts: false }).promise;
      if (pageIndex >= doc.numPages) {
        throw new PageImagePngError('bad_page_index', 'pageIndex ' + pageIndex + ' is outside 0..' + (doc.numPages - 1), { pageIndex, numPages: doc.numPages });
      }
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(1, Math.round((rect[2] - rect[0]) * scale));
      const height = Math.max(1, Math.round((rect[3] - rect[1]) * scale));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      context.fillStyle = 'rgb(255, 255, 255)';
      context.fillRect(0, 0, width, height);
      const viewport = page.getViewport({ scale, offsetX: -rect[0] * scale, offsetY: -(base.height - rect[3]) * scale });
      await page.render({ canvasContext: context, viewport, intent: 'display' }).promise;
      const png = Buffer.from(canvas.toBuffer('image/png'));
      if (!png || png.length === 0) throw new PageImagePngError('render_failed', 'the renderer produced no PNG bytes');
      return { base64: png.toString('base64'), bytes: png.length, width, height, pageIndex };
    } catch (error) {
      if (error instanceof PageImagePngError) throw error;
      throw new PageImagePngError('render_failed', 'pageImagePng failed: ' + String(error && error.message ? error.message : error));
    } finally {
      if (doc && typeof doc.destroy === 'function') {
        try { await doc.destroy(); } catch { /* the document handle is already gone */ }
      }
    }
  };
}

/**
 * The second capability the same edit flow needs: the live-preview raster of one page region
 * with the edited image objects removed. Mirrors the product main-process call
 * (apps/pdf/src/main/image-edit.ts renderPagePreviewPng: render the display page at pxWidth,
 * erase the excluded image rects in memory only, return base64 PNG or null for an unusable clip).
 * pdfjs cannot remove a content-stream object in memory, so the excluded rects are painted with
 * the page background instead - the same visible result for the fixture's image-on-white layout -
 * and an unmatched rect is skipped fail-soft exactly like the product.
 */
// F1 fix (FE review r1): the renderer also sends excludeAnnots when annotation deletes are pending.
// Those rects are erased like image rects, so a deleted annotation disappears from the live preview
// instead of lingering; surviving annotations are not drawn by this preview (pdfjs render default),
// which the row records as a limitation.
export async function renderPagePreviewPng({ pdfjs, createCanvas }, request) {
  if (!request || typeof request !== 'object' || typeof request.path !== 'string' || request.path.length === 0) {
    throw new PageImagePngError('bad_input', 'pagePreviewPng needs { path, pageIndex, clip, pxWidth, rotate }');
  }
  const { clip, pxWidth } = request;
  if (!clip || typeof clip !== 'object' || !isFiniteNumber(Number(clip.x)) || !isFiniteNumber(Number(clip.y)) ||
      !isFiniteNumber(Number(clip.width)) || !isFiniteNumber(Number(clip.height))) {
    throw new PageImagePngError('bad_input', 'pagePreviewPng clip must be { x, y, width, height }');
  }
  if (!isFiniteNumber(Number(pxWidth)) || Number(pxWidth) <= 0 || Number(clip.width) <= 0 || Number(clip.height) <= 0) {
    return null;
  }
  const pageIndex = Number(request.pageIndex);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new PageImagePngError('bad_page_index', 'pageIndex must be a non-negative integer', { pageIndex: request.pageIndex === undefined ? null : request.pageIndex });
  }
  const excludeAnnots = Array.isArray(request.excludeAnnots)
    ? request.excludeAnnots.map((entry) => (entry && Array.isArray(entry.rect) ? entry.rect.map(Number) : null)).filter((rect) => rect && rect.length === 4 && rect.every(isFiniteNumber))
    : [];
  const excludeRects = Array.isArray(request.excludeRects)
    ? request.excludeRects.map((rect) => (Array.isArray(rect) ? rect.map(Number) : null)).filter((rect) => rect && rect.length === 4 && rect.every(isFiniteNumber))
    : [];
  let bytes;
  try {
    bytes = readFileSync(request.path);
  } catch (error) {
    throw new PageImagePngError('bad_input', 'pagePreviewPng cannot read ' + request.path + ': ' + String(error && error.message ? error.message : error));
  }
  let doc = null;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false, useSystemFonts: false }).promise;
    if (pageIndex >= doc.numPages) {
      throw new PageImagePngError('bad_page_index', 'pageIndex ' + pageIndex + ' is outside 0..' + (doc.numPages - 1), { pageIndex, numPages: doc.numPages });
    }
    const page = await doc.getPage(pageIndex + 1);
    const turns = ((Math.trunc(Number(request.rotate) || 0) % 4) + 4) % 4;
    const rotation = ((page.rotate % 360) + 360) % 360 + turns * 90;
    const display = page.getViewport({ scale: 1, rotation });
    const k = Number(pxWidth) / Number(clip.width);
    const width = Math.max(1, Math.round(Number(pxWidth)));
    const height = Math.max(1, Math.round(Number(clip.height) * k));
    const full = page.getViewport({ scale: k, rotation });
    const offscreen = createCanvas(Math.max(1, Math.ceil(full.width)), Math.max(1, Math.ceil(full.height)));
    const offCtx = offscreen.getContext('2d');
    offCtx.fillStyle = 'rgb(255, 255, 255)';
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
    await page.render({ canvasContext: offCtx, viewport: full, intent: 'display' }).promise;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgb(255, 255, 255)';
    context.fillRect(0, 0, width, height);
    context.drawImage(offscreen, Math.round(-Number(clip.x) * k), Math.round(-Number(clip.y) * k));
    const map = page.getViewport({ scale: k, rotation });
    for (const rect of excludeRects.concat(excludeAnnots)) {
      const corners = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]]]
        .map((point) => map.convertToViewportPoint(point[0], point[1]));
      const xs = corners.map((point) => point[0]);
      const ys = corners.map((point) => point[1]);
      const x0 = Math.min(...xs) - Number(clip.x) * k;
      const y0 = Math.min(...ys) - Number(clip.y) * k;
      const w = Math.max(0, Math.max(...xs) - Math.min(...xs));
      const h = Math.max(0, Math.max(...ys) - Math.min(...ys));
      if (w <= 0 || h <= 0) continue;
      context.fillStyle = 'rgb(255, 255, 255)';
      context.fillRect(x0, y0, w, h);
    }
    const png = Buffer.from(canvas.toBuffer('image/png'));
    if (!png || png.length === 0) throw new PageImagePngError('render_failed', 'the preview renderer produced no PNG bytes');
    return { base64: png.toString('base64'), bytes: png.length, width, height, pageIndex, excluded: excludeRects.length, excludedAnnots: excludeAnnots.length };
  } catch (error) {
    if (error instanceof PageImagePngError) throw error;
    throw new PageImagePngError('render_failed', 'pagePreviewPng failed: ' + String(error && error.message ? error.message : error));
  } finally {
    if (doc && typeof doc.destroy === 'function') {
      try { await doc.destroy(); } catch { /* the document handle is already gone */ }
    }
  }
}

/** The channel handler for the preview render, sharing the dependency loader. */
export function createPagePreviewPngHandler({ sourceRoot } = {}) {
  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) {
    throw new PageImagePngError('no_source_root', 'the lab pagePreviewPng channel needs the prepared source root');
  }
  const deps = loadRenderDeps(sourceRoot);
  return async function pagePreviewPng(request) {
    const pdfjs = await deps.pdfjs;
    const canvasModule = await deps.canvas;
    return renderPagePreviewPng({ pdfjs, createCanvas: canvasModule.createCanvas }, request);
  };
}
