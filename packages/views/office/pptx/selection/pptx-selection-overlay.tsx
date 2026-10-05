"use client";

/**
 * The selection overlay mounted inside the slide canvas box: the selection
 * outline, the eight resize handles plus the rotate grip, the live gesture
 * previews and the marquee rectangle.
 *
 * It is pure presentation + pointer plumbing. Every decision (hit-testing,
 * resize math, one-commit-per-gesture) lives in the pure modules next to it.
 */
import { useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import { handlePosition, rotateHandlePositionInBounds, PPTX_RESIZE_HANDLES, type PptxBox, type PptxPoint } from "./geometry";
import type { PptxSelectionController } from "./use-pptx-selection";

export interface PptxSelectionOverlayProps {
  /** Page size of the current slide (the overlay's coordinate space). */
  page: { widthPx: number; heightPx: number };
  /** On-screen size of the slide box. Informational only: the overlay draws in
   *  percent of the page so drawing and hit-testing share one frame. */
  displayWidthPx?: number;
  displayHeightPx?: number;
  controller: PptxSelectionController;
  className?: string;
}

/** Handle hit target size in display px. */
const HANDLE_SIZE_PX = 9;
const ROTATE_SIZE_PX = 11;

export function PptxSelectionOverlay({
  page,
  controller,
  className,
}: PptxSelectionOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const toPage = useCallback((event: ReactPointerEvent<HTMLDivElement>): PptxPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * page.widthPx,
      y: ((event.clientY - rect.top) / rect.height) * page.heightPx,
    };
  }, [page.heightPx, page.widthPx]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 2) {
      // Right-click selects what is under the pointer; the native menu must still open.
      controller.onContextPointerDown(toPage(event));
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    // F3: preventDefault suppresses the compatibility mousedown, which is the event
    // that moves focus to the nearest focusable ancestor -- so the canvas could never
    // take focus and Delete/Escape/arrow keys were dead in the click-first flow. Focus
    // it explicitly here instead, then keep the pointer capture.
    event.currentTarget.closest<HTMLElement>("[data-pptx-canvas]")?.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    controller.onPointerDown(toPage(event), event.shiftKey);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    controller.onPointerMove(toPage(event), event.shiftKey);
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    controller.onPointerUp();
  };

  const bounds = controller.bounds;
  const grip = bounds ? rotateHandlePositionInBounds(bounds, page) : null;
  // `touch-none` on the overlay stops a drag from scrolling the page under a touch
  // pointer, at the cost of a scroll gesture that starts on the slide (the p-4 gutter
  // still scrolls); an accepted desktop-first trade-off.

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-pptx-selection-overlay
      className={cn("absolute inset-0 z-10 touch-none", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={() => controller.onPointerCancel()}
    >
      {controller.previews.map((preview) => (
        <span
          key={preview.sourceId}
          data-pptx-gesture-preview={preview.sourceId}
          className="pointer-events-none absolute border border-dashed border-primary/70"
          style={pageStyle(preview.box, page)}
        />
      ))}
      {bounds ? (
        <span data-pptx-selection-outline className="pointer-events-none absolute border border-primary" style={pageStyle(bounds, page)}>
          {PPTX_RESIZE_HANDLES.map((handle) => (
            <span
              key={handle}
              data-pptx-handle={handle}
              className="absolute rounded-sm border border-primary bg-background"
              style={handleStyle(bounds, handlePosition(bounds, handle), HANDLE_SIZE_PX)}
            />
          ))}
          {grip ? (
            <span
              data-pptx-handle="rotate"
              className="absolute rounded-full border border-primary bg-background"
              style={handleStyle(bounds, grip, ROTATE_SIZE_PX)}
            />
          ) : null}
        </span>
      ) : null}
      {controller.marquee ? (
        <span data-pptx-marquee className="pointer-events-none absolute border border-primary/70 bg-primary/10" style={pageStyle(controller.marquee, page)} />
      ) : null}
    </div>
  );
}

/** A page-space box as percent of the page, so it follows the real overlay box at any zoom. */
function pageStyle(box: PptxBox, page: { widthPx: number; heightPx: number }): CSSProperties {
  const w = page.widthPx > 0 ? page.widthPx : 1;
  const h = page.heightPx > 0 ? page.heightPx : 1;
  return { left: `${(box.x / w) * 100}%`, top: `${(box.y / h) * 100}%`, width: `${(box.w / w) * 100}%`, height: `${(box.h / h) * 100}%` };
}

/** A handle centred on a page point, positioned relative to the selection outline (its offset parent). */
function handleStyle(bounds: PptxBox, point: PptxPoint, sizePx: number): CSSProperties {
  const fx = bounds.w > 0 ? ((point.x - bounds.x) / bounds.w) * 100 : 0;
  const fy = bounds.h > 0 ? ((point.y - bounds.y) / bounds.h) * 100 : 0;
  return { left: `calc(${fx}% - ${sizePx / 2}px)`, top: `calc(${fy}% - ${sizePx / 2}px)`, width: sizePx, height: sizePx };
}
