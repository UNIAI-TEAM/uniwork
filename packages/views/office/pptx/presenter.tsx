"use client";

/**
 * The presenter overlay mount (UNI-927 C2 + WIRE-CANVAS-BIND).
 *
 * A thin adapter over the built presenter surface (`./show`): it opens as a
 * fullscreen `role="dialog"`, hands it the REAL slide rendition the editor
 * canvas mounts (never the 160px rail thumbnail, P0-2 F6), renders the speaker
 * notes when the host bound them, and returns focus to the trigger on close.
 * It owns no editor handle, worker, or save path.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { useOfficeDocumentActiveRef } from "../common/document-active";
import type { PptxCanvasContent } from "./canvas/pptx-canvas-surface";
import { PptxPresenterView } from "./show";
import { applyShowNavAction, isShowActivationKey, isShowInteractiveTarget, resolveShowNavAction } from "./show/show-nav";

export interface PptxPresenterProps {
  /** Slide count of the deck being presented. */
  slideCount: number;
  /** 0-based index of the slide on screen. */
  selectedIndex: number;
  open: boolean;
  onClose: () => void;
  /** The SAME SVG document the editor canvas mounts for the current slide. */
  content?: PptxCanvasContent | null;
  /** The next slide's rendition (null on the last slide). */
  nextContent?: PptxCanvasContent | null;
  /** Speaker notes for the current slide; null while the host has not loaded them. */
  notes?: string | null;
  /** A deck is bound and its rendition is still being built. */
  building?: boolean;
  /** Move the presented slide without closing the presenter. */
  onIndexChange?: (index: number) => void;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
  className?: string;
}

export function PptxPresenter({
  slideCount,
  selectedIndex,
  open,
  onClose,
  content = null,
  nextContent = null,
  notes = null,
  building = false,
  onIndexChange,
  now,
  className,
}: PptxPresenterProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const closeRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const activeRef = useOfficeDocumentActiveRef();
  // WIRE-CANVAS-BIND F1: the presenter is the only mounted show surface, so the
  // full nav contract (not Escape alone) lives here. Focus goes to the surface
  // itself - never the "Close presenter" button - so Space/Enter advance the
  // show instead of activating the exit control.
  useEffect(() => {
    if (!open) return;
    surfaceRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // UNI-957: a presenter behind a hidden desktop tab ignores the visible deck's keys.
      if (!activeRef.current) return;
      if (isShowActivationKey(event.key) && isShowInteractiveTarget(event.target)) return;
      const action = resolveShowNavAction(event.key);
      if (!action) return;
      event.preventDefault();
      if (action === "exit") {
        onClose();
        return;
      }
      const moved = applyShowNavAction(action, selectedIndex, slideCount);
      if (moved !== selectedIndex) onIndexChange?.(moved);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRef, onClose, onIndexChange, open, selectedIndex, slideCount]);
  if (!open) return null;
  return (
    <div ref={surfaceRef} tabIndex={-1} className={cn("fixed inset-0 z-50 outline-none", className)} data-pptx-presenter>
      <PptxPresenterView
        slideCount={slideCount}
        index={selectedIndex}
        onIndexChange={onIndexChange ?? (() => undefined)}
        onExit={onClose}
        content={content}
        nextContent={nextContent}
        notes={notes}
        building={building}
        {...(now ? { now } : {})}
      />
      <div className="pointer-events-none absolute bottom-3 right-3">
        <Button ref={closeRef} type="button" size="sm" variant="secondary" className="pointer-events-auto" onClick={onClose}>
          {t("close_presenter")}
        </Button>
      </div>
    </div>
  );
}
