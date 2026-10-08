"use client";

/**
 * HtmlSelectionOverlay — the H5 selection bridge over the S1 inspector.
 *
 * It is the FIRST consumer of the shell's `onPreviewEvent` slot. The shell
 * forwards every validated inspector event into a `PreviewEventSink`; this
 * component folds them into a selection and paints an inert outline in the
 * `overlay` slot. It never edits: no H3 op, no command back to the frame.
 *
 * The whole surface is behind `OFFICE_HTML_VISUAL_EDIT_FLAG` (server default on, client
 * fallback off). With the flag off this component returns null and does nothing else, so the shell is
 * byte-for-byte the same behaviour it had before H5.
 *
 * The outline is positioned from the rect the inspector reported, clamped by
 * the model, plus the preview frame's offset inside the canvas. The rect is in
 * the frame's INTERNAL viewport px, while the shell renders the frame's
 * content scaled by its CSS `zoom`; the canvas-space box is therefore
 * `frameOffset + zoom * rect` in size and position. In split mode the frame
 * does not start at the canvas origin, and the offset moves without any
 * inspector event (the parent scrolls when zoom>100% overflows, the window or
 * split pane resizes, the zoom changes), so the offset is re-probed on those
 * signals. Every probe only reads layout (no DOM writes), and the whole thing
 * is skipped while the flag is off or no rect is known.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { OFFICE_HTML_VISUAL_EDIT_FLAG, useFlag } from "@uniwork/core/feature-flags";
import { FRAME_OFFSET_ZERO, frameOffset, watchFrameOffset, type FrameOffset } from "../frame-offset";
import { clampZoom } from "../shell-model";
import {
  HTML_SELECTION_EMPTY,
  reduceSelection,
  type HtmlSelection,
  type HtmlSelectionRect,
  type PreviewEventSink,
} from "./model";

export interface HtmlSelectionOverlayProps {
  /** The shell's fan-out for forwarded preview events. */
  sink: PreviewEventSink;
  /** The `relative` canvas the outline positions against. */
  canvasRef: RefObject<HTMLElement | null>;
  /**
   * The shell's clamped zoom ladder value, in percent. The preview wrapper
   * scales its content by `zoom/100`, so the outline must be scaled by the
   * same factor to sit on the element instead of at `offset + rect`.
   */
  zoom?: number;
  /**
   * The preview pane's scroll container. Scrolling it (which happens exactly
   * when zoom>100% makes the preview overflow) moves the frame and emits no
   * inspector event, so the offset is re-probed on its `scroll` events.
   */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Published on every committed-selection change (select, not hover). */
  onSelectionChange?(selection: HtmlSelection | null): void;
}

/**
 * The overlay child. It is `absolute` inside the shell's `relative` canvas
 * (the F5 contract) and `pointer-events-none`, so it is inert: it cannot take
 * a click, a drag or a focus from the document behind it.
 */
export function HtmlSelectionOverlay({ sink, canvasRef, zoom = 100, scrollRef, onSelectionChange }: HtmlSelectionOverlayProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.selection" });
  const enabled = useFlag(OFFICE_HTML_VISUAL_EDIT_FLAG, false);
  const [state, setState] = useState(HTML_SELECTION_EMPTY);
  const [offset, setOffset] = useState<FrameOffset>(FRAME_OFFSET_ZERO);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  useEffect(() => {
    if (!enabled) {
      // Flag off: drop whatever was reported and stay inert.
      setState(HTML_SELECTION_EMPTY);
      return undefined;
    }
    return sink.subscribe((event) => setState((current) => reduceSelection(current, event)));
  }, [enabled, sink]);

  const selected = enabled ? state.selected : null;
  const rect = selected?.rect ?? null;

  useEffect(() => {
    if (!enabled || rect === null) return undefined;
    // Re-probe now (a rect can arrive long after the frame was laid out) and
    // then on every signal that moves the frame without an inspector event.
    return watchFrameOffset(canvasRef.current, scrollRef?.current, () => setOffset(frameOffset(canvasRef.current)));
    // `rect` is re-probed whenever new geometry arrives; `zoom` whenever the
    // frame is re-scaled.
  }, [enabled, rect, zoom, canvasRef, scrollRef]);

  const wasEnabled = useRef(false);
  useEffect(() => {
    if (!enabled) {
      // A flag turned OFF clears the caller's last selection once, so H6-H8
      // cannot act on a selection H5 no longer tracks. A fresh disabled mount
      // publishes nothing at all: a caller cannot tell H5 exists.
      if (wasEnabled.current) onSelectionChangeRef.current?.(null);
      wasEnabled.current = false;
      return;
    }
    wasEnabled.current = true;
    onSelectionChangeRef.current?.(selected);
  }, [enabled, selected]);

  if (selected === null || rect === null) return null;

  const scale = clampZoom(zoom) / 100;
  const style = {
    left: `${offset.x + scale * rect.x}px`,
    top: `${offset.y + scale * rect.y}px`,
    width: `${scale * rect.width}px`,
    height: `${scale * rect.height}px`,
  };

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute z-10 border-2 border-primary bg-primary/10"
        style={style}
        data-testid="html-selection-outline"
        data-selection-sid={selected.sid}
        data-selection-node={selected.nodeName ?? undefined}
      />
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="html-selection-status"
        data-selection-sid={selected.sid}
      >
        {t("announce", { sid: selected.sid })}
      </span>
    </>
  );
}
