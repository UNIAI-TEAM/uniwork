"use client";

/**
 * The PPTX status bar (C10): a 28 px strip at the bottom of the editor.
 *
 * Left  = slide x/y, word/character counts, document language.
 * Right = selection info and the zoom control (- value +).
 *
 * Presentational and props-driven: the wiring owns the numbers, and a field it
 * cannot source yet renders the unknown mark instead of a fabricated value
 * (the DOCX status bar's rule). Selection/position text lives ONLY here, never
 * in the ribbon (C6).
 */
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { PptxCanvasZoom } from "./canvas/pptx-canvas-zoom";

/** Counts the wiring can precompute; a missing field renders the unknown mark. */
export interface PptxStatusCounts {
  words?: number | null;
  characters?: number | null;
}

export interface PptxStatusBarProps {
  /** 1-based current slide; null when no deck is bound. */
  slideCurrent?: number | null;
  slideTotal?: number | null;
  counts?: PptxStatusCounts | null;
  /** BCP-47 tag; the bar shows the primary subtag. */
  language?: string | null;
  /** Selected element count; null/undefined means "nothing selected". */
  selectionCount?: number | null;
  /** A gesture is applying; shown as a live status on the left. */
  gesturePending?: boolean;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  className?: string;
}

// Structural decoration between readouts, not copy.
const SEPARATOR = "\u00b7";

/** First subtag of a BCP-47 tag: `vi-VN` reads as `vi`; a blank tag has none. */
export function pptxLanguageLabel(language: string | null | undefined): string | null {
  if (typeof language !== "string") return null;
  const primary = language.trim().replace(/_/g, "-").split("-")[0]?.toLowerCase() ?? "";
  return primary.length > 0 ? primary : null;
}

function countText(value: number | null | undefined, unknown: string): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : unknown;
}

function positiveInt(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function PptxStatusBar({
  slideCurrent,
  slideTotal,
  counts,
  language,
  selectionCount,
  gesturePending = false,
  zoom,
  onZoomChange,
  className,
}: PptxStatusBarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const unknown = t("status.unknown");
  const current = positiveInt(slideCurrent);
  const total = positiveInt(slideTotal);
  const languageLabel = pptxLanguageLabel(language);
  const slideText =
    current === null && total === null
      ? unknown
      : t("status.slide", {
          current: current === null ? unknown : String(current),
          total: total === null ? unknown : String(total),
        });
  const selected = typeof selectionCount === "number" && selectionCount > 0;

  const left: ReadonlyArray<{ testId: string; text: string }> = [
    { testId: "pptx-status-slide", text: slideText },
    { testId: "pptx-status-words", text: t("status.words", { value: countText(counts?.words, unknown) }) },
    { testId: "pptx-status-characters", text: t("status.characters", { value: countText(counts?.characters, unknown) }) },
    { testId: "pptx-status-language", text: t("status.language", { language: languageLabel ?? unknown }) },
  ];

  return (
    <div
      role="group"
      aria-label={t("status.label")}
      // Counts change on every edit; a live region would read out each one.
      aria-live="off"
      data-pptx-status-bar
      className={cn(
        "flex h-7 min-w-0 shrink-0 flex-nowrap items-center justify-between gap-2 overflow-hidden whitespace-nowrap border-t border-border bg-muted/20 px-2 text-caption text-muted-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-x-2 overflow-hidden">
        {left.map((item, index) => (
          <Fragment key={item.testId}>
            {index > 0 ? (
              <span aria-hidden="true" className="shrink-0 text-faint-foreground">{SEPARATOR}</span>
            ) : null}
            <span className="min-w-0 truncate" data-testid={item.testId}>{item.text}</span>
          </Fragment>
        ))}
        {gesturePending ? (
          <span role="status" data-testid="pptx-gesture-pending" className="shrink-0">{t("gesture_pending")}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span data-testid="pptx-status-selection">
          {selected ? t("status.selection", { value: String(selectionCount) }) : t("status.selection_none")}
        </span>
        <PptxCanvasZoom zoom={zoom} onZoomChange={onZoomChange} showFit={false} className="gap-0" />
      </div>
    </div>
  );
}
