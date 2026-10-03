"use client";

/**
 * Rail thumbnails: every slide is built at a small fit width and serialized to the same SVG
 * the canvas mounts, then handed to `PptxSlideRail` as a `data:` URL. Generation is
 * incremental (one slide per idle slice, cancellable) so mounting the editor never waits for
 * a whole deck, and results are cached per (slide id, deck revision, width, theme).
 *
 * The small build width is what separates a thumbnail from the on-screen rendition in the
 * shared artifact spy: the canvas builds the selected slide at the measured fit width
 * (960 px before a container measures one, see `PPTX_FALLBACK_FIT_WIDTH`), every rail
 * thumbnail at `PPTX_THUMBNAIL_WIDTH` (160 px).
 */
import { useEffect, useRef, useState } from "react";
import type { PptxDeckRenderer } from "./deck-renderer";

/** The rail draws thumbnails at 112-144 px; 160 keeps text legible without much geometry. */
export const PPTX_THUMBNAIL_WIDTH = 160;

const CACHE_LIMIT = 256;
const cache = new Map<string, string>();

/** Test seam and deck-switch reset. */
export function clearPptxThumbnailCache(): void {
  cache.clear();
}

/** Cache key of one thumbnail: the slide, its deck revision, the build width and the theme the
 *  chip palette was resolved for (a light/dark switch must not serve the previous colours). */
export function pptxThumbnailKey(slideId: string, revision: string | number | undefined, widthPx: number, theme = "light"): string {
  return `${slideId}@${revision ?? 0}@${widthPx}@${theme}`;
}

export interface PptxThumbnailSlide {
  id: string;
  label?: string;
}

interface PptxThumbnailOptions {
  /** Deck renderer from `usePptxDeckRenderer`; null until the artifact + deck are ready. */
  renderer: PptxDeckRenderer | null;
  /**
   * Rail order. `renderer.buildThumbnail` is positional while results are keyed by `slide.id`,
   * so `slides[i]` must be the deck's slide `i` -- a host that reorders or filters this view
   * attaches the wrong image to an id with no error. Pass the deck order, or extend the
   * renderer seam to resolve by id before feeding a reordered view.
   */
  slides: readonly PptxThumbnailSlide[];
  revision?: string | number;
  widthPx?: number;
  /** Theme the chip palette was resolved for; defaults to the document's light/dark class. */
  theme?: string;
}

type ScheduleHandle = number;

function schedule(callback: () => void): ScheduleHandle {
  if (typeof requestIdleCallback === "function") return requestIdleCallback(() => callback()) as unknown as ScheduleHandle;
  return setTimeout(callback, 0) as unknown as ScheduleHandle;
}

function unschedule(handle: ScheduleHandle): void {
  if (typeof cancelIdleCallback === "function") {
    cancelIdleCallback(handle);
    return;
  }
  clearTimeout(handle);
}

/** `slideId -> data URL`, filled in as slides are rendered. */
export function usePptxThumbnails({ renderer, slides, revision, widthPx = PPTX_THUMBNAIL_WIDTH, theme }: PptxThumbnailOptions): Map<string, string> {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(() => new Map());
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  // Without an explicit theme, key on the document's light/dark class so a theme switch
  // invalidates the cache even though the renderer instance and deck revision do not change.
  const resolvedTheme = theme ?? (typeof document === "undefined" ? "light" : document.documentElement.classList.contains("dark") ? "dark" : "light");
  const signature = slides.map((slide) => slide.id).join("\u0000");
  useEffect(() => {
    if (!renderer || !signature) {
      setThumbnails(new Map());
      return undefined;
    }
    const list = slidesRef.current;
    let cancelled = false;
    let handle: ScheduleHandle | null = null;
    const ready = new Map<string, string>();
    const pending: number[] = [];
    list.forEach((slide, index) => {
      const hit = cache.get(pptxThumbnailKey(slide.id, revision, widthPx, resolvedTheme));
      if (hit) ready.set(slide.id, hit);
      else pending.push(index);
    });
    setThumbnails(new Map(ready));
    const step = (): void => {
      if (cancelled) return;
      const index = pending.shift();
      if (index === undefined) return;
      const slide = list[index];
      if (slide) {
        try {
          const url = renderer.buildThumbnail(index, widthPx, slide.label);
          if (url) {
            if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
            cache.set(pptxThumbnailKey(slide.id, revision, widthPx, resolvedTheme), url);
            ready.set(slide.id, url);
            setThumbnails(new Map(ready));
          }
        } catch {
          // One unrenderable slide must not stop the rest of the rail.
        }
      }
      handle = schedule(step);
    };
    handle = schedule(step);
    return () => {
      cancelled = true;
      if (handle != null) unschedule(handle);
    };
  }, [renderer, revision, resolvedTheme, signature, widthPx]);
  return thumbnails;
}
