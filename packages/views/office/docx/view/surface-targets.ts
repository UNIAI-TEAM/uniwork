"use client";

// UNI-924 A6-wire: the DOM bridge between the mounted DOCX surface and the
// View modules. The editor handle deliberately exposes no engine/DOM accessors,
// so the wiring resolves the surface by the ids the shell renders:
//
//   [data-testid="docx-canvas"]
//     [data-testid="docx-document-surface"]   (the .editor-scroll viewport)
//       .doc-zoom                             (zoom property + --page-* geometry)
//
// The geometry comes from the CSS variables the pagination driver paints on
// `.doc-zoom` (docxPageGeometryVars), converted back to the twips the ruler
// model speaks; nothing here mutates the surface.

import { useEffect, useState } from "react";
import type { RendererSection } from "@uniwork/office-upstream/docs-renderer-editor";
import type { DocxZoomPageSize } from "./zoom-controller";

export const DOCX_CANVAS_SELECTOR = '[data-testid="docx-canvas"]';
export const DOCX_SURFACE_SELECTOR = '[data-testid="docx-document-surface"]';
const DOCX_ZOOM_SELECTOR = ".doc-zoom";

const TWIPS_PER_PX = 1440 / 96;

export interface DocxViewSurfaceGeometry {
  /** Page box at 100% for the fit math; null until the first pagination pass. */
  pageSize: DocxZoomPageSize | null;
  /** Section settings for the ruler, in twips; null on the same condition. */
  settings: RendererSection["settings"] | null;
  /** Raw `--page-*` values, so a publish can cheaply detect a real change. */
  key: string;
}

export interface DocxViewSurface extends DocxViewSurfaceGeometry {
  scrollElement: HTMLElement;
  zoomElement: HTMLElement;
}

function cssPx(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Page box and section settings from the geometry variables on `.doc-zoom`. */
export function docxViewSurfaceGeometry(zoomElement: HTMLElement): DocxViewSurfaceGeometry {
  const style = zoomElement.style;
  const widthPx = cssPx(style.getPropertyValue("--page-w"));
  const heightPx = cssPx(style.getPropertyValue("--page-h"));
  const [topPx, rightPx, bottomPx, leftPx] = style
    .getPropertyValue("--page-pad")
    .trim()
    .split(/\s+/)
    .map(cssPx);
  const key = ["--page-w", "--page-h", "--page-pad"].map((name) => style.getPropertyValue(name)).join("|");
  const pageSize =
    widthPx !== null && heightPx !== null && widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
  const settings: RendererSection["settings"] | null =
    widthPx !== null && heightPx !== null && widthPx > 0 && heightPx > 0 &&
    topPx !== null && topPx !== undefined &&
    rightPx !== null && rightPx !== undefined &&
    bottomPx !== null && bottomPx !== undefined &&
    leftPx !== null && leftPx !== undefined
      ? {
          pageWidth: widthPx * TWIPS_PER_PX,
          pageHeight: heightPx * TWIPS_PER_PX,
          marginTop: topPx * TWIPS_PER_PX,
          marginRight: rightPx * TWIPS_PER_PX,
          marginBottom: bottomPx * TWIPS_PER_PX,
          marginLeft: leftPx * TWIPS_PER_PX,
        }
      : null;
  return { pageSize, settings, key };
}

/** Resolve the mounted surface inside `scope` (the editor canvas). */
export function readDocxViewSurface(scope: ParentNode): DocxViewSurface | null {
  const scrollElement = scope.querySelector<HTMLElement>(DOCX_SURFACE_SELECTOR);
  const zoomElement = scrollElement?.querySelector<HTMLElement>(DOCX_ZOOM_SELECTOR) ?? null;
  if (!scrollElement || !zoomElement) return null;
  return { scrollElement, zoomElement, ...docxViewSurfaceGeometry(zoomElement) };
}

function sameDocxViewSurface(a: DocxViewSurface | null, b: DocxViewSurface | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.scrollElement === b.scrollElement && a.zoomElement === b.zoomElement && a.key === b.key;
}

/**
 * Track the live surface. The canvas observes the whole subtree below it —
 * the surface chain (docx-surface > workspace > editor-scroll > `.doc-zoom`)
 * is several levels deep, so an inner re-render may swap `workspace`,
 * `editor-scroll` or `.doc-zoom` without touching the canvas' direct children.
 * While both tracked elements are still connected there is nothing to
 * re-resolve, which keeps typing and decoration churn cheap. `.doc-zoom` also
 * observes its own style attribute so the page geometry the pagination driver
 * paints later is picked up. The returned object is identity-stable while
 * nothing changed, so consumers can put it in effect dependencies.
 *
 * Scope: the FIRST `[data-testid="docx-canvas"]` in the document (body while
 * the shell has not mounted it). Sound while one DOCX editor is on the page;
 * two editors at once (split view, tests) would share this resolution — see
 * `getDocxZoomController` for the matching controller caveat.
 */
export function useDocxViewSurface(): DocxViewSurface | null {
  const [surface, setSurface] = useState<DocxViewSurface | null>(null);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return undefined;
    const scope: ParentNode = document.querySelector(DOCX_CANVAS_SELECTOR) ?? document.body;
    let observedZoom: HTMLElement | null = null;
    let observedScroll: HTMLElement | null = null;
    let styleObserver: MutationObserver | null = null;

    const publish = () => {
      const next = readDocxViewSurface(scope);
      observedScroll = next?.scrollElement ?? null;
      if ((next?.zoomElement ?? null) !== observedZoom) {
        styleObserver?.disconnect();
        observedZoom = next?.zoomElement ?? null;
        if (observedZoom) {
          styleObserver = new MutationObserver(publish);
          styleObserver.observe(observedZoom, { attributes: true, attributeFilter: ["style"] });
        }
      }
      setSurface((current) => (sameDocxViewSurface(current, next) ? current : next));
    };

    const canvasObserver = new MutationObserver(() => {
      if (observedZoom?.isConnected && observedScroll?.isConnected) return;
      publish();
    });
    canvasObserver.observe(scope, { childList: true, subtree: true });
    publish();
    return () => {
      canvasObserver.disconnect();
      styleObserver?.disconnect();
    };
  }, []);

  return surface;
}
