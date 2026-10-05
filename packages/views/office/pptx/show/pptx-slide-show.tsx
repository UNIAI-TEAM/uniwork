"use client";

/**
 * The audience slide show (C2, UNI-927; visual-END F-05).
 *
 * A fullscreen show over the SAME rendition the canvas mounts: it receives
 * the current slide's SVG document (built by `buildSlideSvg`, emitted by
 * `SvgNodeView`) and never invents slide content. It is a view over the
 * existing session - index and exit are owned by the caller, and there is no
 * editor handle, worker, or save path here.
 *
 * - Fullscreen: on mount the show asks the Fullscreen API for its own root
 *   (web and Electron alike). A refusal (no API, no user gesture, an iframe
 *   without `allowfullscreen`) leaves the fixed full-viewport overlay, which
 *   is still a complete show. Leaving browser fullscreen (the browser eats Esc
 *   in fullscreen and fires `fullscreenchange` instead) ends the show.
 * - Keys follow PowerPoint's presentation contract (`resolveShowNavAction`):
 *   Right / Space / Enter / PageDown advance, Left / PageUp go back, Home / End
 *   jump to the ends, Esc exits. A click on the stage advances.
 * - Keys are taken in the capture phase before any editor listener (document
 *   or below) sees them, and the editor's undo/redo chords are swallowed, so
 *   nothing edits the deck behind the audience.
 * - Hidden slides (`hidden[i]`) are skipped; past the last visible slide the
 *   show says it has ended and the next advance exits, as PowerPoint does.
 * - Focus moves to the show surface (never the exit button, so Enter/Space
 *   advance) and returns to whatever held it before, on exit.
 * - Transitions: the canvas renders none yet, so the show cuts between slides.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { SvgNodeView, type PptxCanvasContent } from "../canvas/pptx-canvas-surface";
import { firstVisibleFrom, isShowActivationKey, isShowInteractiveTarget, resolveShowNavAction, visibleShowTarget, type PptxShowNavAction } from "./show-nav";

/** Ctrl/Cmd + Z / Y: the editor's history chords, which must never reach the deck behind a show. */
function isHistoryChord(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  const key = event.key.toLowerCase();
  return key === "z" || key === "y";
}

export interface PptxSlideShowProps {
  /** Slide count of the deck being shown. */
  slideCount: number;
  /** 0-based index of the slide on screen; owned by the caller. */
  index: number;
  onIndexChange: (index: number) => void;
  /** Esc, the exit control, leaving browser fullscreen, or advancing past the end. */
  onExit: () => void;
  /** SVG document of the current slide (null while it is not available). */
  content?: PptxCanvasContent | null;
  /** Per-slide hidden flags; a hidden slide is skipped by the show. */
  hidden?: readonly boolean[];
  /** A deck is bound and its rendition is still being built. */
  building?: boolean;
  /** Ask the Fullscreen API on mount (default true). */
  fullscreen?: boolean;
  className?: string;
}

export function PptxSlideShow({
  slideCount,
  index,
  onIndexChange,
  onExit,
  content = null,
  hidden,
  building = false,
  fullscreen = true,
  className,
}: PptxSlideShowProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const rootRef = useRef<HTMLDivElement>(null);
  const exitedRef = useRef(false);
  const onExitRef = useRef(onExit);
  // The end screen belongs to the slide it was reached from: when the caller
  // moves the show (rail, presenter) it no longer applies.
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const ended = endedAt === index;

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  // The show never opens ON a hidden slide: start from the first visible one at
  // or after the requested index (PowerPoint's "from current slide" on a hidden
  // slide). Runs once per mount, in a layout effect: the parent's state update
  // then flushes synchronously before the browser paints, so the hidden slide
  // never gets a frame on screen (a passive effect lands after the first paint).
  const mountedRef = useRef({ index, hidden, slideCount, onIndexChange, done: false });
  useLayoutEffect(() => {
    const mounted = mountedRef.current;
    if (mounted.done) return;
    mounted.done = true;
    const start = firstVisibleFrom(mounted.index, mounted.slideCount, mounted.hidden);
    if (start !== mounted.index) mounted.onIndexChange(start);
  }, []);

  // One exit per show, however many paths fire (Esc keydown then the
  // fullscreenchange it causes). Stable, so the mount effect below never re-runs
  // (and re-requests fullscreen) when the caller passes an inline `onExit`.
  const exit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    onExitRef.current();
  }, []);

  // Focus + fullscreen lifecycle. The trigger that opened the show gets focus
  // back on unmount, whichever path ended it.
  useEffect(() => {
    const root = rootRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root?.focus();
    let entered = false;
    const onFullscreenChange = () => {
      if (document.fullscreenElement === root) entered = true;
      else if (entered) exit();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    if (fullscreen && root && typeof root.requestFullscreen === "function" && document.fullscreenEnabled !== false) {
      void Promise.resolve()
        .then(() => root.requestFullscreen())
        .catch(() => undefined);
    }
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (root && document.fullscreenElement === root && typeof document.exitFullscreen === "function") {
        void Promise.resolve()
          .then(() => document.exitFullscreen())
          .catch(() => undefined);
      }
      if (previous?.isConnected) previous.focus();
    };
  }, [exit, fullscreen]);

  const navigate = useCallback(
    (action: Exclude<PptxShowNavAction, "exit">) => {
      if (ended) {
        if (action === "next") exit();
        else if (action === "previous") setEndedAt(null);
        else {
          setEndedAt(null);
          const target = visibleShowTarget(action, index, slideCount, hidden);
          if (target !== null && target !== index) onIndexChange(target);
        }
        return;
      }
      const target = visibleShowTarget(action, index, slideCount, hidden);
      if (target === null) {
        setEndedAt(index);
        return;
      }
      if (target !== index) onIndexChange(target);
    },
    [ended, exit, hidden, index, onIndexChange, slideCount],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isHistoryChord(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (isShowActivationKey(event.key) && isShowInteractiveTarget(event.target)) return;
      const action = resolveShowNavAction(event.key);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "exit") exit();
      else navigate(action);
    };
    // Capture on window runs before the editor's document-level listeners, so
    // a key the show consumes never reaches them.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [exit, navigate]);

  const counter = t("show.counter", { current: slideCount ? index + 1 : 0, total: slideCount });
  const atStart = visibleShowTarget("previous", index, slideCount, hidden) === index;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("show.label")}
      tabIndex={-1}
      className={cn("group fixed inset-0 z-50 flex flex-col bg-meeting-stage text-meeting-stage-foreground", className)}
      data-pptx-slide-show
      data-pptx-show-ended={ended ? "true" : undefined}
    >
      <button
        type="button"
        className="flex min-h-0 flex-1 cursor-pointer items-center justify-center overflow-hidden"
        aria-label={ended ? t("show.exit") : t("show.next")}
        data-pptx-show-stage
        data-testid="pptx-show-stage"
        onClick={() => navigate("next")}
      >
        {ended ? (
          <span className="text-body text-meeting-bar-muted-foreground" data-testid="pptx-show-ended">{t("show.end_of_show")}</span>
        ) : content ? (
          <svg
            className="block h-full w-full"
            viewBox={`0 0 ${content.widthPx} ${content.heightPx}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            focusable="false"
            data-pptx-show-svg
          >
            <SvgNodeView node={content.root} />
          </svg>
        ) : (
          <span className="text-body text-meeting-bar-muted-foreground">{t(building ? "render_building" : "render_pending")}</span>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 py-3">
        <div
          className={cn(
            // A dark bar, not bare chips: the slide fills the stage and is usually white, so
            // chips drawn straight on it vanish. Dimmed at idle, full on hover/focus.
            "pointer-events-auto flex items-center gap-2 rounded-full border border-meeting-bar-border bg-meeting-bar-bg px-3 py-1.5 text-meeting-bar-foreground",
            "opacity-70 transition-opacity group-hover:opacity-100 hover:opacity-100 focus-within:opacity-100",
            "pointer-coarse:opacity-100",
          )}
          data-pptx-show-controls
        >
          <Button type="button" size="sm" variant="meetingChip" disabled={atStart && !ended} aria-label={t("show.previous")} onClick={() => navigate("previous")}>
            <ChevronLeft aria-hidden />
            <span>{t("show.previous")}</span>
          </Button>
          <span className="px-2 text-caption text-meeting-bar-muted-foreground" data-testid="pptx-show-counter">{counter}</span>
          <Button type="button" size="sm" variant="meetingChip" disabled={ended} aria-label={t("show.next")} onClick={() => navigate("next")}>
            <span>{t("show.next")}</span>
            <ChevronRight aria-hidden />
          </Button>
          <Button type="button" size="sm" variant="meetingChip" onClick={exit} aria-label={t("show.exit")}>
            <X aria-hidden />
            <span>{t("show.exit")}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
