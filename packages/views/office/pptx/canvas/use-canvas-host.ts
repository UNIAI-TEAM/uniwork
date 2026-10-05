"use client";

/**
 * Canvas host hooks: artifact loading, token palette, container measurement and the
 * (deck, revision) -> render-tree memoization. Kept apart from the surface component so the
 * component stays presentational and every hook is testable on its own.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPptxDeckRenderer, type PptxDeckModel, type PptxDeckRenderer } from "./deck-renderer";
import { readPptxPalette, type PptxCanvasPalette, type PptxImageSize } from "./paint";
import type { PptxRendererModule } from "./renderer-module";
import type { PptxRenderSlide } from "./render-tree";
import { resolveFitWidth } from "./zoom";

export type PptxRendererState =
  | { status: "loading" }
  | { status: "ready"; module: PptxRendererModule }
  | { status: "error"; message: string };

/** Loads the browser artifact once the canvas has a deck to render. The loader is a seam,
 *  not state: reading it through a ref keeps an inline `loadRendererModule` prop from
 *  restarting the load (and from looping) on every parent render. A disabled host (no deck
 *  bound yet) never pulls the bundle. */
export function usePptxRendererModule(loadModule: () => Promise<PptxRendererModule>, enabled = true): PptxRendererState {
  const loaderRef = useRef(loadModule);
  loaderRef.current = loadModule;
  const [state, setState] = useState<PptxRendererState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    void loaderRef.current().then(
      (module) => {
        if (!disposed) setState({ status: "ready", module });
      },
      (error: unknown) => {
        if (!disposed) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      disposed = true;
    };
  }, [enabled]);
  return state;
}

function rootStyle(): { getPropertyValue(name: string): string } {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return { getPropertyValue: () => "" };
  return getComputedStyle(document.documentElement);
}

/** Semantic-token palette for the canvas, re-read when the theme class changes. */
export function usePptxPalette(): PptxCanvasPalette {
  const [palette, setPalette] = useState<PptxCanvasPalette>(() => readPptxPalette(rootStyle()));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setPalette(readPptxPalette(rootStyle())));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}

export interface PptxDeckRendererInput {
  /** Opaque deck model the artifact's `buildRenderSlide` consumes. */
  deck?: PptxDeckModel;
  /** Model generation; a new value drops every cached rendition. */
  revision?: string | number;
  resolveMedia?: (mediaRef: string) => string | undefined;
  imageSize?: (dataUrl: string) => PptxImageSize | undefined;
}

/** One deck renderer per (artifact, deck, revision, revision palette). */
export function usePptxDeckRenderer(
  state: PptxRendererState,
  input: PptxDeckRendererInput,
  idPrefix: string,
  palette: PptxCanvasPalette,
): PptxDeckRenderer | null {
  const callbacks = useRef({ resolveMedia: input.resolveMedia, imageSize: input.imageSize });
  callbacks.current = { resolveMedia: input.resolveMedia, imageSize: input.imageSize };
  const { deck, revision } = input;
  return useMemo(() => {
    if (state.status !== "ready" || !deck) return null;
    return createPptxDeckRenderer(
      state.module,
      {
        deck,
        ...(revision !== undefined ? { revision } : {}),
        ...(callbacks.current.resolveMedia ? { resolveMedia: callbacks.current.resolveMedia } : {}),
        ...(callbacks.current.imageSize ? { imageSize: callbacks.current.imageSize } : {}),
      },
      { idPrefix, palette },
    );
  }, [deck, idPrefix, palette, revision, state]);
}

/** Render tree of the current slide at the current fit width. */
export function useSlideRendition(renderer: PptxDeckRenderer | null, slideIndex: number, fitWidthPx: number): PptxRenderSlide | null {
  return useMemo(() => (renderer ? renderer.buildSlide(slideIndex, fitWidthPx) : null), [renderer, slideIndex, fitWidthPx]);
}

/** Measured element width, with a fallback for the first paint and layout-less DOMs. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallbackPx: number): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return resolveFitWidth(width, resolveFitWidth(fallbackPx));
}
