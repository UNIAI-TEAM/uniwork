"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- role=application is the keyboard slide surface */

/**
 * The slide surface: an SVG rendition of the current render tree inside a scrollable
 * `role="application"` canvas. Zoom is a viewBox-scaled display transform — the tree is
 * built at the measured fit width, so the vector content stays crisp at any zoom.
 *
 * The a11y contract is unchanged from the previous placeholder canvas: `role="application"`,
 * `aria-label` from `office.pptx.canvas_label`, `data-pptx-canvas`, `data-slide-canvas` and
 * `data-slide-index` (P0-3 selects against the same hooks).
 *
 * P0-3 integration point (the only canvas change the selection lane makes): an `overlay`
 * slot rendered inside the slide box, so the selection outline/handles/marquee share the
 * SVG's coordinate box without the canvas knowing what a selection is.
 */
import { createElement, useEffect, useRef, type KeyboardEventHandler, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { reactSvgProps, type SvgNode } from "./svg-node";
import { useElementWidth } from "./use-canvas-host";
import { PPTX_FALLBACK_FIT_WIDTH, resolveFitWidth, slideDisplaySize } from "./zoom";

/** Recursive SVG emitter: one `SvgNode` description -> React elements. */
export function SvgNodeView({ node }: { node: SvgNode }): ReactElement {
  const children: ReactElement[] | undefined = node.children?.map((child, index) => createElement(SvgNodeView, { key: index, node: child }));
  return createElement(node.tag, reactSvgProps(node.attrs), node.text ?? children);
}

export interface PptxCanvasContent {
  root: SvgNode;
  widthPx: number;
  heightPx: number;
  hidden?: boolean;
}

export interface PptxCanvasSurfaceProps {
  /** SVG document of the current slide (null while it is not available). */
  content: PptxCanvasContent | null;
  slideIndex: number;
  slideCount: number;
  /** 1 = fit width. */
  zoom: number;
  /** Build width used until the container measures one (and in layout-less DOMs). */
  fallbackFitWidthPx?: number;
  /** A deck is bound and its rendition is still being built (P0-2 F16): the pending
   *  state then says "building" instead of "not connected to this application". */
  building?: boolean;
  /** Measured container width, so the caller can rebuild the tree at fit scale. */
  onFitWidthChange?: (widthPx: number) => void;
  /** Keyboard slide navigation owned by the editor. */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** Selection overlay (P0-3), rendered inside the slide box in page coordinates. */
  overlay?: ReactNode;
  className?: string;
}

export function PptxCanvasSurface({
  content,
  slideIndex,
  slideCount,
  zoom,
  fallbackFitWidthPx = PPTX_FALLBACK_FIT_WIDTH,
  building = false,
  onFitWidthChange,
  onKeyDown,
  overlay,
  className,
}: PptxCanvasSurfaceProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const fitProbeRef = useRef<HTMLDivElement>(null);
  // Fit width is the canvas viewport's *content* width: measuring the scroll container
  // would include its p-4 gutter and make a 100% slide overflow by 32px. The probe is an
  // absolutely positioned, zero-height child of the same padded box.
  const fitWidthPx = useElementWidth(fitProbeRef, resolveFitWidth(fallbackFitWidthPx));
  useEffect(() => {
    onFitWidthChange?.(fitWidthPx);
  }, [fitWidthPx, onFitWidthChange]);
  const aspect = content && content.widthPx > 0 ? content.heightPx / content.widthPx : 9 / 16;
  const display = slideDisplaySize(fitWidthPx, zoom, aspect);
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)} data-pptx-canvas-root>
      <div
        className="relative flex min-h-48 flex-1 items-start justify-center overflow-auto bg-office-canvas p-4"
        role="application"
        aria-label={t("canvas_label")}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-pptx-canvas
      >
        <div ref={fitProbeRef} aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-4 h-0" data-pptx-fit-probe />
        {slideCount === 0 ? <p className="self-center text-body text-muted-foreground">{t("no_slides")}</p> : null}
        {slideCount > 0 && content ? (
          <div
            className="relative shrink-0 overflow-hidden bg-white shadow-surface"
            style={{ width: display.widthPx, height: display.heightPx }}
            data-slide-canvas
            data-slide-index={slideIndex}
          >
            <svg
              className="block"
              viewBox={`0 0 ${content.widthPx} ${content.heightPx}`}
              width={display.widthPx}
              height={display.heightPx}
              aria-hidden="true"
              focusable="false"
              data-pptx-slide-svg
            >
              <SvgNodeView node={content.root} />
            </svg>
            {overlay}
            {content.hidden ? (
              <span className="absolute left-1 top-1 rounded-sm border border-border bg-muted px-1 text-caption text-muted-foreground" data-pptx-slide-hidden>
                {t("slide_hidden")}
              </span>
            ) : null}
          </div>
        ) : null}
        {slideCount > 0 && !content ? <p className="self-center text-body text-muted-foreground" data-testid="pptx-render-pending" data-pptx-render-pending>{t(building ? "render_building" : "render_pending")}</p> : null}
      </div>
    </div>
  );
}
