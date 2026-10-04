"use client";

/**
 * The slide-show surface (C2, UNI-927).
 *
 * A full-viewport show over the SAME rendition the canvas mounts: it receives
 * the current slide's SVG document (built by `buildSlideSvg`, emitted by
 * `SvgNodeView`) and never invents slide content. It is a view over the
 * existing session - index and exit are owned by the caller, and there is no
 * editor handle, worker, or save path here.
 *
 * Keys follow PowerPoint's presentation contract (see `resolveShowNavAction`):
 * Right / Space / Enter / PageDown advance, Left / PageUp go back, Home / End
 * jump to the ends, Esc exits. A click on the stage advances.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { SvgNodeView, type PptxCanvasContent } from "../canvas/pptx-canvas-surface";
import { applyShowNavAction, resolveShowNavAction } from "./show-nav";

export interface PptxSlideShowProps {
  /** Slide count of the deck being shown. */
  slideCount: number;
  /** 0-based index of the slide on screen; owned by the caller. */
  index: number;
  onIndexChange: (index: number) => void;
  /** Esc, the exit control, or the caller's own end-of-show rule. */
  onExit: () => void;
  /** SVG document of the current slide (null while it is not available). */
  content?: PptxCanvasContent | null;
  /** A deck is bound and its rendition is still being built. */
  building?: boolean;
  className?: string;
}

/** Space and Enter also activate a focused control; those two stay with the
 *  control, every other show key is handled here. */
function isActivationKey(key: string): boolean {
  return key === " " || key === "Spacebar" || key === "Enter";
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  return tag === "button" || tag === "a" || tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
}

export function PptxSlideShow({
  slideCount,
  index,
  onIndexChange,
  onExit,
  content = null,
  building = false,
  className,
}: PptxSlideShowProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const exitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    exitRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isActivationKey(event.key) && isInteractiveTarget(event.target)) return;
      const action = resolveShowNavAction(event.key);
      if (!action) return;
      event.preventDefault();
      if (action === "exit") {
        onExit();
        return;
      }
      const moved = applyShowNavAction(action, index, slideCount);
      if (moved !== index) onIndexChange(moved);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, onExit, onIndexChange, slideCount]);

  const step = (direction: "next" | "previous") => onIndexChange(applyShowNavAction(direction, index, slideCount));
  const counter = t("show.counter", { current: slideCount ? index + 1 : 0, total: slideCount });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("show.label")}
      className={cn("fixed inset-0 z-50 flex flex-col bg-meeting-stage text-meeting-stage-foreground", className)}
      data-pptx-slide-show
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <span className="text-label" data-testid="pptx-show-counter">{counter}</span>
        <Button ref={exitRef} type="button" size="sm" variant="meetingChip" onClick={onExit} aria-label={t("show.exit")}>
          <X aria-hidden />
          <span>{t("show.exit")}</span>
        </Button>
      </div>
      <button
        type="button"
        className="flex min-h-0 flex-1 cursor-pointer items-center justify-center overflow-hidden p-4"
        aria-label={t("show.next")}
        data-pptx-show-stage
        data-testid="pptx-show-stage"
        onClick={() => step("next")}
      >
        {content ? (
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
      <div className="flex shrink-0 items-center justify-center gap-2 px-4 py-3">
        <Button type="button" size="sm" variant="meetingChip" disabled={index <= 0} aria-label={t("show.previous")} onClick={() => step("previous")}>
          <ChevronLeft aria-hidden />
          <span>{t("show.previous")}</span>
        </Button>
        <span className="px-2 text-caption text-meeting-bar-muted-foreground" data-testid="pptx-show-counter-footer">{counter}</span>
        <Button type="button" size="sm" variant="meetingChip" disabled={index >= slideCount - 1} aria-label={t("show.next")} onClick={() => step("next")}>
          <span>{t("show.next")}</span>
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
