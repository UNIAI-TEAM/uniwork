/**
 * The one place that maps the preview frame into the canvas's coordinate space,
 * shared by the H5 selection outline and the H6 float toolbar so the two can
 * never drift apart.
 *
 * Both overlays are `absolute` children of the `relative` canvas, so their
 * `left`/`top` live in the canvas's padding-box CONTENT space. When the panes
 * stack (below `lg`) the canvas is itself the scroll container, and that space
 * moves with its scroll: the frame's viewport position minus the canvas's
 * viewport position is short by exactly `scrollTop`/`scrollLeft`, and short by
 * the canvas border, which sits outside the padding box.
 */

/** The preview frame's structural hook, set by the shell on the element that
 * hosts the injected session. A dedicated `data-*` attribute, not the pane's
 * testing testid, so renaming a test hook cannot move the overlays. */
const PREVIEW_FRAME_ATTR = "data-html-preview-frame";

export interface FrameOffset {
  x: number;
  y: number;
}

export const FRAME_OFFSET_ZERO: FrameOffset = { x: 0, y: 0 };

/** Read-only layout probe: where the preview frame sits in the canvas's
 * absolute-positioning space. Zero when there is no frame (jsdom, no port). */
export function frameOffset(canvas: HTMLElement | null): FrameOffset {
  if (!canvas) return FRAME_OFFSET_ZERO;
  const frame = canvas.querySelector(`[${PREVIEW_FRAME_ATTR}]`);
  if (!(frame instanceof HTMLElement)) return FRAME_OFFSET_ZERO;
  const canvasRect = canvas.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  return {
    x: frameRect.left - canvasRect.left - canvas.clientLeft + canvas.scrollLeft,
    y: frameRect.top - canvasRect.top - canvas.clientTop + canvas.scrollTop,
  };
}

/**
 * Call `probe` now and on every signal that moves the frame without an
 * inspector event: the preview pane's scroll, the canvas's own scroll (stacked
 * panes) and a canvas resize. Returns the cleanup.
 */
export function watchFrameOffset(
  canvas: HTMLElement | null,
  previewScroll: HTMLElement | null | undefined,
  probe: () => void,
): () => void {
  probe();
  previewScroll?.addEventListener("scroll", probe, { passive: true });
  canvas?.addEventListener("scroll", probe, { passive: true });
  const observer = canvas !== null && typeof ResizeObserver === "function" ? new ResizeObserver(probe) : null;
  if (observer !== null && canvas !== null) observer.observe(canvas);
  return () => {
    previewScroll?.removeEventListener("scroll", probe);
    canvas?.removeEventListener("scroll", probe);
    observer?.disconnect();
  };
}
