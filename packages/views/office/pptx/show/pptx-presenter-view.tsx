"use client";

/**
 * The presenter view (C2, UNI-927).
 *
 * A view over the existing session: the current slide plus a next-slide
 * preview, the speaker notes for the current slide, and an elapsed timer. It
 * has no editor handle, worker, or save path of its own - the deck model and
 * the rendition come from the caller, and navigation is reported back through
 * `onIndexChange` exactly like the show surface.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { SvgNodeView, type PptxCanvasContent } from "../canvas/pptx-canvas-surface";
import { applyShowNavAction, formatElapsedClock } from "./show-nav";

export interface PptxPresenterViewProps {
  /** Slide count of the deck being presented. */
  slideCount: number;
  /** 0-based index of the slide on screen; owned by the caller. */
  index: number;
  onIndexChange: (index: number) => void;
  onExit: () => void;
  /** SVG document of the current slide. */
  content?: PptxCanvasContent | null;
  /** SVG document of the next slide (null on the last slide). */
  nextContent?: PptxCanvasContent | null;
  /** Speaker notes of the current slide; null while the host has not loaded them. */
  notes?: string | null;
  /** A deck is bound and its rendition is still being built. */
  building?: boolean;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
  className?: string;
}

/** A framed SVG rendition; the current slide and the next-slide preview share it. */
function SlideFrame({ content, building, label, testId }: { content: PptxCanvasContent | null; building: boolean; label: string; testId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1" data-testid={testId}>
      <span className="text-caption text-meeting-bar-muted-foreground">{label}</span>
      {content ? (
        <svg
          className="block max-h-full w-full"
          viewBox={`0 0 ${content.widthPx} ${content.heightPx}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
          data-pptx-presenter-svg
        >
          <SvgNodeView node={content.root} />
        </svg>
      ) : (
        <span className="text-caption text-meeting-bar-muted-foreground">{t(building ? "render_building" : "render_pending")}</span>
      )}
    </div>
  );
}

export function PptxPresenterView({
  slideCount,
  index,
  onIndexChange,
  onExit,
  content = null,
  nextContent = null,
  notes = null,
  building = false,
  now = Date.now,
  className,
}: PptxPresenterViewProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [startedAt] = useState(() => now());
  const [elapsedMs, setElapsedMs] = useState(0);

  // One interval for the whole session; the clock is presentation-local, so
  // nothing outside this view observes it.
  useEffect(() => {
    setElapsedMs(now() - startedAt);
    const handle = setInterval(() => setElapsedMs(now() - startedAt), 1000);
    return () => clearInterval(handle);
  }, [now, startedAt]);

  const step = (direction: "next" | "previous") => onIndexChange(applyShowNavAction(direction, index, slideCount));
  const currentLabel = t("show.current_slide", { index: slideCount ? index + 1 : 0 });
  const nextLabel = t("show.next_slide", { index: slideCount ? index + 2 : 0 });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("presenter_title")}
      className={cn("fixed inset-0 z-50 flex flex-col gap-2 bg-meeting-stage p-3 text-meeting-stage-foreground", className)}
      data-pptx-presenter-view
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-label" data-testid="pptx-presenter-timer" data-elapsed-ms={elapsedMs}>
          {t("show.timer", { elapsed: formatElapsedClock(elapsedMs) })}
        </span>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="meetingChip" disabled={index <= 0} aria-label={t("show.previous")} onClick={() => step("previous")}>
            <ChevronLeft aria-hidden />
            <span>{t("show.previous")}</span>
          </Button>
          <Button type="button" size="sm" variant="meetingChip" disabled={index >= slideCount - 1} aria-label={t("show.next")} onClick={() => step("next")}>
            <span>{t("show.next")}</span>
            <ChevronRight aria-hidden />
          </Button>
          <Button type="button" size="sm" variant="meetingChip" onClick={onExit} aria-label={t("show.exit")}>
            <X aria-hidden />
            <span>{t("show.exit")}</span>
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-[3] flex-col rounded-md border border-meeting-bar-border bg-meeting-video-bg p-2">
          <SlideFrame content={content} building={building} label={currentLabel} testId="pptx-presenter-current" />
        </div>
        <div className="flex min-h-0 min-w-0 flex-[2] flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col rounded-md border border-meeting-bar-border bg-meeting-video-bg p-2">
            <SlideFrame content={nextContent} building={building} label={nextLabel} testId="pptx-presenter-next" />
          </div>
          <section aria-label={t("show.notes")} className="min-h-0 flex-1 overflow-auto rounded-md border border-meeting-bar-border bg-meeting-bar-chip-bg p-2" data-testid="pptx-presenter-notes">
            <h2 className="mb-1 text-label">{t("show.notes")}</h2>
            <p className="whitespace-pre-wrap text-body">{notes ? notes : t("show.notes_empty")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
