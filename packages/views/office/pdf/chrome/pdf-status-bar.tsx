"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

/** Counts the PDF chrome can show on the left of the status bar (C10). */
export interface PdfStatusCounts {
  words?: number;
  characters?: number;
  annotations?: number;
}

const COUNT_LABEL_KEYS: Readonly<Record<keyof PdfStatusCounts, string>> = {
  words: "office.pdf.chrome.count.words",
  characters: "office.pdf.chrome.count.characters",
  annotations: "office.pdf.chrome.count.annotations",
};

const COUNT_ORDER: readonly (keyof PdfStatusCounts)[] = ["words", "characters", "annotations"];

export interface PdfStatusBarProps {
  page: number;
  pageCount: number;
  counts?: PdfStatusCounts;
  language?: string;
  /** Already-formatted selection summary, e.g. "12 characters selected". */
  selection?: string | null;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * The 28px status bar (C10): page position, counts and language on the left,
 * selection summary and zoom controls on the right. Selection and position text
 * live here, never in the ribbon.
 */
export function PdfStatusBar({
  page,
  pageCount,
  counts,
  language,
  selection,
  zoom,
  onZoomChange,
  className,
  minZoom = 0.25,
  maxZoom = 4,
}: PdfStatusBarProps) {
  const { t } = useTranslation();
  const safeCount = Math.max(0, Math.trunc(pageCount));
  const safePage = safeCount === 0 ? 0 : Math.min(Math.max(1, Math.trunc(page)), safeCount);
  const percent = Math.round(zoom * 100);
  const changeZoom = (delta: number) =>
    onZoomChange?.(Math.min(maxZoom, Math.max(minZoom, Number((zoom + delta).toFixed(2)))));

  return (
    <footer
      className={cn(
        "flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-border bg-muted/30 px-3 py-0.5 text-caption text-muted-foreground",
        className,
      )}
      data-testid="pdf-status-bar"
      aria-label={t("office.pdf.chrome.statusBarLabel")}
    >
      <div className="flex min-w-0 items-center gap-2" data-testid="pdf-status-left">
        <span className="tabular-nums" data-testid="pdf-status-page">
          {t("office.pdf.chrome.statusBarPage", { page: safePage, total: safeCount })}
        </span>
        {COUNT_ORDER.map((key) => {
          const value = counts?.[key];
          if (value === undefined) return null;
          return (
            <span key={key} className="hidden tabular-nums sm:inline" data-testid={`pdf-status-count-${key}`}>
              {t("office.pdf.chrome.statusBarCount", { value, label: t(COUNT_LABEL_KEYS[key]) })}
            </span>
          );
        })}
        {language ? (
          <span className="hidden truncate sm:inline" data-testid="pdf-status-language">
            {language}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2" data-testid="pdf-status-right">
        {selection ? (
          <span className="hidden truncate sm:inline" data-testid="pdf-status-selection">
            {selection}
          </span>
        ) : null}
        <div className="flex items-center gap-1" data-testid="pdf-status-zoom">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("office.pdf.chrome.zoomOut")}
            disabled={zoom <= minZoom}
            onClick={() => changeZoom(-0.1)}
          >
            <Minus aria-hidden />
          </Button>
          <span className="min-w-12 text-center tabular-nums" aria-live="polite" data-testid="pdf-status-zoom-value">
            {t("office.pdf.chrome.zoom", { percent })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("office.pdf.chrome.zoomIn")}
            disabled={zoom >= maxZoom}
            onClick={() => changeZoom(0.1)}
          >
            <Plus aria-hidden />
          </Button>
        </div>
      </div>
    </footer>
  );
}
