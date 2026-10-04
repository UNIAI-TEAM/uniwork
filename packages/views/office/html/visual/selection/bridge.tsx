"use client";

/**
 * HtmlSelectionOverlay — the H5 selection bridge over the S1 inspector.
 *
 * It is the FIRST consumer of the shell's `onPreviewEvent` slot. The shell
 * forwards every validated inspector event into a `PreviewEventSink`; this
 * component folds them into a selection and paints an inert outline in the
 * `overlay` slot. It never edits: no H3 op, no command back to the frame.
 *
 * The whole surface is behind `HTML_SELECTION_FLAG` (default OFF). With the
 * flag off this component returns null and does nothing else, so the shell is
 * byte-for-byte the same behaviour it had before H5.
 *
 * The outline is positioned from the rect the inspector reported, clamped by
 * the model, plus the preview frame's offset inside the canvas: the frame is
 * the origin of that rect, and in split mode the frame does not start at the
 * canvas origin. The offset probe only reads layout (no DOM writes, no state),
 * and it is skipped entirely while the flag is off or no rect is known.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import {
  HTML_SELECTION_EMPTY,
  HTML_SELECTION_FLAG,
  reduceSelection,
  type HtmlSelection,
  type HtmlSelectionRect,
  type PreviewEventSink,
} from "./model";

/** The preview pane's testid, set by the shell; the frame fills it. */
const PREVIEW_FRAME_TESTID = "html-preview";

interface Offset {
  x: number;
  y: number;
}

const ZERO: Offset = { x: 0, y: 0 };

/** Read-only layout probe: how far the preview frame sits from the canvas
 * origin. Returns zero when there is no frame (jsdom, no preview port). */
function frameOffset(canvas: HTMLElement | null): Offset {
  if (!canvas) return ZERO;
  const frame = canvas.querySelector(`[data-testid="${PREVIEW_FRAME_TESTID}"]`);
  if (!(frame instanceof HTMLElement)) return ZERO;
  const canvasRect = canvas.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  return { x: frameRect.left - canvasRect.left, y: frameRect.top - canvasRect.top };
}

export interface HtmlSelectionOverlayProps {
  /** The shell's fan-out for forwarded preview events. */
  sink: PreviewEventSink;
  /** The `relative` canvas the outline positions against. */
  canvasRef: RefObject<HTMLElement | null>;
  /** Published on every committed-selection change (select, not hover). */
  onSelectionChange?(selection: HtmlSelection | null): void;
}

/**
 * The overlay child. It is `absolute` inside the shell's `relative` canvas
 * (the F5 contract) and `pointer-events-none`, so it is inert: it cannot take
 * a click, a drag or a focus from the document behind it.
 */
export function HtmlSelectionOverlay({ sink, canvasRef, onSelectionChange }: HtmlSelectionOverlayProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.selection" });
  const enabled = useFlag(HTML_SELECTION_FLAG, false);
  const [state, setState] = useState(HTML_SELECTION_EMPTY);
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
  useEffect(() => {
    // Flag off: publish nothing at all - the surface must not even report a
    // null selection, so a caller cannot tell H5 exists.
    if (!enabled) return;
    onSelectionChangeRef.current?.(selected);
  }, [enabled, selected]);

  if (selected === null || selected.rect === null) return null;

  const offset = frameOffset(canvasRef.current);
  const rect: HtmlSelectionRect = selected.rect;
  const style = {
    left: `${offset.x + rect.x}px`,
    top: `${offset.y + rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
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
