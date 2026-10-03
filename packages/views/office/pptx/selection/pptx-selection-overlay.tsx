"use client";

/**
 * The selection overlay mounted inside the slide canvas box: the selection
 * outline, the eight resize handles plus the rotate grip, the live gesture
 * previews and the marquee rectangle.
 *
 * It is pure presentation + pointer plumbing. Every decision (hit-testing,
 * resize math, one-commit-per-gesture) lives in the pure modules next to it.
 */
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import { handlePosition, rotateHandlePositionInBounds, PPTX_RESIZE_HANDLES, type PptxBox, type PptxPoint } from "./geometry";
import type { PptxSelectionController } from "./use-pptx-selection";

export interface PptxSelectionOverlayProps {
  /** Page size of the current slide (the overlay's coordinate space). */
  page: { widthPx: number; heightPx: number };
  /** On-screen size of the slide box (page px * zoom). */
  displayWidthPx: number;
  displayHeightPx: number;
  controller: PptxSelectionController;
  className?: string;
}

/** Handle hit target size in display px. */
const HANDLE_SIZE_PX = 9;
const ROTATE_SIZE_PX = 11;

export function PptxSelectionOverlay({
  page,
  displayWidthPx,
  displayHeightPx,
  controller,
  className,
}: PptxSelectionOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scaleX = page.widthPx > 0 ? displayWidthPx / page.widthPx : 1;
  const scaleY = page.heightPx > 0 ? displayHeightPx / page.heightPx : 1;

  const toPage = useCallback((event: ReactPointerEvent<HTMLDivElement>): PptxPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * page.widthPx,
      y: ((event.clientY - rect.top) / rect.height) * page.heightPx,
    };
  }, [page.heightPx, page.widthPx]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
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
          style={displayStyle(preview.box, scaleX, scaleY)}
        />
      ))}
      {bounds ? (
        <span data-pptx-selection-outline className="pointer-events-none absolute border border-primary" style={displayStyle(bounds, scaleX, scaleY)}>
          {PPTX_RESIZE_HANDLES.map((handle) => {
            const point = handlePosition(bounds, handle);
            return (
              <span
                key={handle}
                data-pptx-handle={handle}
                className="absolute rounded-sm border border-primary bg-background"
                style={{
                  left: point.x * scaleX - HANDLE_SIZE_PX / 2,
                  top: point.y * scaleY - HANDLE_SIZE_PX / 2,
                  width: HANDLE_SIZE_PX,
                  height: HANDLE_SIZE_PX,
                }}
              />
            );
          })}
          {grip ? (
            <span
              data-pptx-handle="rotate"
              className="absolute rounded-full border border-primary bg-background"
              style={{
                left: grip.x * scaleX - ROTATE_SIZE_PX / 2,
                top: grip.y * scaleY - ROTATE_SIZE_PX / 2,
                width: ROTATE_SIZE_PX,
                height: ROTATE_SIZE_PX,
              }}
            />
          ) : null}
        </span>
      ) : null}
      {controller.marquee ? (
        <span data-pptx-marquee className="pointer-events-none absolute border border-primary/70 bg-primary/10" style={displayStyle(controller.marquee, scaleX, scaleY)} />
      ) : null}
    </div>
  );
}

function displayStyle(box: PptxBox, scaleX: number, scaleY: number): { left: number; top: number; width: number; height: number } {
  return { left: box.x * scaleX, top: box.y * scaleY, width: box.w * scaleX, height: box.h * scaleY };
}
