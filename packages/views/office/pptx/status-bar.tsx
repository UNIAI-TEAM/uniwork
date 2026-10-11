"use client";

/**
 * The PPTX status bar (C10): a 28 px strip at the bottom of the editor.
 *
 * Left  = slide x/y, word/character counts, document language.
 * Right = selection info and the zoom control (- value +).
 *
 * Presentational and props-driven: the wiring owns the numbers, and a readout it
 * cannot source (counts, deck language) is left out rather than shown as a
 * placeholder (T12). Selection/position text lives ONLY here, never in the
 * ribbon (C6). The right cluster also carries the Notes toggle and the view
 * buttons (Normal / Slide sorter / Slide show); each shows only when wired.
 */
import { Fragment, type ReactNode } from "react";
import { CircleQuestionMark, LayoutGrid, Monitor, Presentation, StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { OfficeStatusActions, OfficeStatusBar, OfficeStatusZoom, type OfficeStatusAction } from "../frame/office-status-bar";
import { PPTX_ZOOM_MAX, PPTX_ZOOM_MIN, stepZoom, zoomPercent } from "./canvas/zoom";

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
  /** Notes pane toggle; absent hides the button. */
  notesOpen?: boolean;
  onToggleNotes?: () => void;
  /** Normal / Slide sorter view; absent hides the button. */
  view?: "normal" | "sorter";
  onViewChange?: (view: "normal" | "sorter") => void;
  /** Starts the slide show; absent hides the button. */
  onSlideShow?: () => void;
  /** A gesture is applying; shown as a live status on the left. */
  gesturePending?: boolean;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** The shortcuts-help trigger; always the last item of the row. */
  help?: ReactNode;
  className?: string;
}

// Structural decoration between readouts, not copy.
const SEPARATOR = "\u00b7";

/** Phone width (<= 480px): the readout is not rendered, the row stays one line. */
const NARROW_HIDDEN = "max-[480px]:hidden";

/** First subtag of a BCP-47 tag: `vi-VN` reads as `vi`; a blank tag has none. */
export function pptxLanguageLabel(language: string | null | undefined): string | null {
  if (typeof language !== "string") return null;
  const primary = language.trim().replace(/_/g, "-").split("-")[0]?.toLowerCase() ?? "";
  return primary.length > 0 ? primary : null;
}

function isCount(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
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
  notesOpen = false,
  onToggleNotes,
  view = "normal",
  onViewChange,
  onSlideShow,
  gesturePending = false,
  zoom,
  onZoomChange,
  help,
  className,
}: PptxStatusBarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const unknown = t("status.unknown");
  const current = positiveInt(slideCurrent);
  const total = positiveInt(slideTotal);
  const languageLabel = pptxLanguageLabel(language);
  const slideText =
    current === null && total === null
      ? null
      : t("status.slide", {
          current: current === null ? unknown : String(current),
          total: total === null ? unknown : String(total),
        });
  const selected = typeof selectionCount === "number" && selectionCount > 0;

  // F-09: the slide position is the one readout a phone keeps (it never
  // truncates); the counts and language drop out below 480px instead of
  // shrinking into "S... W.. Ch..".
  const left: Array<{ testId: string; text: string; essential?: boolean }> = [];
  if (slideText !== null) left.push({ testId: "pptx-status-slide", text: slideText, essential: true });
  if (isCount(counts?.words)) left.push({ testId: "pptx-status-words", text: t("status.words", { value: String(counts?.words) }) });
  if (isCount(counts?.characters)) left.push({ testId: "pptx-status-characters", text: t("status.characters", { value: String(counts?.characters) }) });
  if (languageLabel !== null) left.push({ testId: "pptx-status-language", text: t("status.language", { language: languageLabel }) });
  const viewActions: OfficeStatusAction[] = [
    ...(onToggleNotes ? [{ id: "notes", label: t("status.notes"), icon: <StickyNote aria-hidden />, pressed: notesOpen, onClick: onToggleNotes }] : []),
    ...(onViewChange ? [
      { id: "view-normal", label: t("status.viewNormal"), icon: <Monitor aria-hidden />, pressed: view === "normal", onClick: () => onViewChange("normal") },
      { id: "view-sorter", label: t("status.viewSorter"), icon: <LayoutGrid aria-hidden />, pressed: view === "sorter", onClick: () => onViewChange("sorter") },
    ] : []),
    ...(onSlideShow ? [{ id: "view-show", label: t("status.viewShow"), icon: <Presentation aria-hidden />, onClick: onSlideShow }] : []),
  ];

  return (
    <div className={cn("contents", className)} data-pptx-status-bar aria-live="off">
      <OfficeStatusBar
        labelKey="office.pptx.status.label"
        start={
          <div className="flex min-w-0 items-center gap-x-2 overflow-hidden">
            {left.map((item, index) => (
              <Fragment key={item.testId}>
                {index > 0 ? (
                  <span aria-hidden="true" className={cn("shrink-0 text-faint-foreground", !item.essential && NARROW_HIDDEN)}>{SEPARATOR}</span>
                ) : null}
                <span className={cn(item.essential ? "shrink-0" : cn("min-w-0 truncate", NARROW_HIDDEN))} data-testid={item.testId}>{item.text}</span>
              </Fragment>
            ))}
            {gesturePending ? (
              <span role="status" data-testid="pptx-gesture-pending" className="shrink-0">{t("gesture_pending")}</span>
            ) : null}
          </div>
        }
        end={
          <>
            <OfficeStatusActions label={t("status.viewLabel")} actions={viewActions} className="max-[480px]:hidden" />
            <span data-testid="pptx-status-selection" className={cn(!selected && NARROW_HIDDEN)}>
              {selected ? t("status.selection", { value: String(selectionCount) }) : t("status.selection_none")}
            </span>
            <span data-pptx-zoom className="contents">
              <OfficeStatusZoom
                value={zoomPercent(zoom)}
                onZoomIn={() => onZoomChange(stepZoom(zoom, 1))}
                onZoomOut={() => onZoomChange(stepZoom(zoom, -1))}
                onReset={() => onZoomChange(1)}
                min={PPTX_ZOOM_MIN * 100}
                max={PPTX_ZOOM_MAX * 100}
              />
            </span>
          </>
        }
        help={help}
      />
    </div>
  );
}

/** The shortcuts-help trigger; the last item of the row. */
export function PptxStatusHelpButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const label = t("office.pptx.shortcuts.help");
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-label={label} title={label} data-pptx-status-help onClick={onOpen}>
      <CircleQuestionMark aria-hidden />
    </Button>
  );
}
