"use client";

import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export interface OfficeStatusBarProps {
  /** Readouts (page x/y, words, language). */
  start?: ReactNode;
  /** Selection info, view modes, zoom. */
  end?: ReactNode;
  /** Help button, always the last item. */
  help?: ReactNode;
  /** aria-label i18n key; defaults to `office.status.label`. */
  labelKey?: string;
  className?: string;
}

/** One 28px row under the canvas, shared by every Office format. */
export function OfficeStatusBar({ start, end, help, labelKey, className }: OfficeStatusBarProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t(labelKey ?? "office.status.label")}
      className={cn(
        "flex h-7 shrink-0 items-center pointer-coarse:h-11 gap-3 border-t border-border bg-office-band px-2 text-caption text-muted-foreground",
        className,
      )}
      data-office-status-bar
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 truncate whitespace-nowrap">{start}</div>
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        {end}
        {help}
      </div>
    </div>
  );
}

export interface OfficeStatusZoomProps {
  value: number | null;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onReset?: () => void;
  min?: number;
  max?: number;
}

export function OfficeStatusZoom({ value, onZoomIn, onZoomOut, onReset, min = 10, max = 500 }: OfficeStatusZoomProps) {
  const { t } = useTranslation();
  const known = typeof value === "number" && Number.isFinite(value);
  const text = known ? t("office.status.zoomValue", { value: Math.round(value) }) : "–";
  const atMin = known && value <= min;
  const atMax = known && value >= max;
  return (
    <div className="flex items-center gap-0.5" data-office-status-zoom>
      <Button
        type="button" variant="ghost" size="icon-xs" aria-label={t("office.status.zoomOut")} title={t("office.status.zoomOut")}
        aria-disabled={atMin || !onZoomOut || undefined}
        onClick={atMin ? undefined : onZoomOut}
      >
        <Minus aria-hidden />
      </Button>
      {onReset ? (
        <Button
          type="button" variant="ghost" size="xs" title={t("office.status.zoomReset")}
          // Label in name (WCAG 2.5.3): the visible value leads the accessible name.
          aria-label={`${text} ${t("office.status.zoomReset")}`}
          className="min-w-10 tabular-nums" onClick={onReset}
        >
          {text}
        </Button>
      ) : (
        <span className="min-w-10 text-center tabular-nums">{text}</span>
      )}
      <Button
        type="button" variant="ghost" size="icon-xs" aria-label={t("office.status.zoomIn")} title={t("office.status.zoomIn")}
        aria-disabled={atMax || !onZoomIn || undefined}
        onClick={atMax ? undefined : onZoomIn}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}
