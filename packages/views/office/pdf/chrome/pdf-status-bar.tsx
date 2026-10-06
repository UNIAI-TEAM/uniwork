"use client";

import { Fragment, type ReactNode, type Ref } from "react";
import { Maximize, MoveHorizontal, PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { OfficeStatusActions, OfficeStatusBar, OfficeStatusZoom } from "../../frame/office-status-bar";

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

// Structural decoration between readouts, not copy.
const SEPARATOR = "\u00b7";
const ZOOM_STEP = 0.1;

export interface PdfStatusBarProps {
  page: number;
  pageCount: number;
  counts?: PdfStatusCounts;
  language?: string;
  /** Already-formatted selection summary, e.g. "12 characters selected". */
  selection?: string | null;
  /** Zoom as a fraction (1 = 100%). */
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  /** Below the sm breakpoint the thumbnail rail is hidden; when a host passes the
   *  toggle, the bar shows the button that opens it (hidden from sm up). */
  onRailToggle?: () => void;
  railOpen?: boolean;
  /** The toggle button, so the host can return focus to it when the rail closes. */
  railToggleRef?: Ref<HTMLButtonElement>;
  /** Fit buttons: each shows only when the host can measure the pane. */
  onFitWidth?: () => void;
  onFitPage?: () => void;
  /** The shortcuts-help trigger; always the last item of the row (F9). */
  help?: ReactNode;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * The single 28px status band (C10, F9): page position, counts and language on
 * the left, selection summary and zoom controls on the right, help last.
 * Selection and position text live here, never in the ribbon.
 */
export function PdfStatusBar({
  page,
  pageCount,
  counts,
  language,
  selection,
  zoom,
  onZoomChange,
  onRailToggle,
  railOpen = false,
  railToggleRef,
  onFitWidth,
  onFitPage,
  help,
  className,
  minZoom = 0.25,
  maxZoom = 4,
}: PdfStatusBarProps) {
  const { t } = useTranslation();
  const safeCount = Math.max(0, Math.trunc(pageCount));
  const safePage = safeCount === 0 ? 0 : Math.min(Math.max(1, Math.trunc(page)), safeCount);
  const changeZoom = (delta: number) =>
    onZoomChange?.(Math.min(maxZoom, Math.max(minZoom, Number((zoom + delta).toFixed(2)))));

  const left: { testId: string; text: string; hide?: string }[] = [
    { testId: "pdf-status-page", text: t("office.pdf.chrome.statusBarPage", { page: safePage, total: safeCount }) },
  ];
  for (const key of COUNT_ORDER) {
    const value = counts?.[key];
    if (value === undefined) continue;
    left.push({
      testId: `pdf-status-count-${key}`,
      text: t("office.pdf.chrome.statusBarCount", { value, label: t(COUNT_LABEL_KEYS[key]) }),
      hide: "max-sm:hidden",
    });
  }
  if (language) left.push({ testId: "pdf-status-language", text: language, hide: "max-sm:hidden" });

  return (
    <div className={cn("contents", className)} data-testid="pdf-status-bar">
      <OfficeStatusBar
        labelKey="office.pdf.chrome.statusBarLabel"
        start={
          <div className="flex min-w-0 items-center gap-x-2" data-testid="pdf-status-left">
            {onRailToggle ? (
              <Button
                ref={railToggleRef} type="button" variant="ghost" size="icon-xs" className="sm:hidden" data-testid="pdf-rail-toggle"
                aria-label={t(railOpen ? "office.pdf.chrome.hideThumbnails" : "office.pdf.chrome.showThumbnails")}
                title={t(railOpen ? "office.pdf.chrome.hideThumbnails" : "office.pdf.chrome.showThumbnails")}
                aria-pressed={railOpen} onClick={onRailToggle}
              >
                <PanelLeft aria-hidden />
              </Button>
            ) : null}
            {left.map((item, index) => (
              <Fragment key={item.testId}>
                {index > 0 ? (
                  <span aria-hidden="true" className={cn("shrink-0 text-faint-foreground", item.hide)}>
                    {SEPARATOR}
                  </span>
                ) : null}
                <span className={cn("min-w-0 truncate tabular-nums", item.hide)} data-testid={item.testId}>
                  {item.text}
                </span>
              </Fragment>
            ))}
          </div>
        }
        end={
          <div className="flex min-w-0 shrink-0 items-center gap-x-2" data-testid="pdf-status-right">
            {selection ? (
              <span className="min-w-0 truncate max-md:hidden" data-testid="pdf-status-selection">
                {selection}
              </span>
            ) : null}
            <OfficeStatusActions
              label={t("office.status.viewLabel")}
              actions={[
                ...(onFitWidth ? [{ id: "fit-width", label: t("office.status.fitWidth"), icon: <MoveHorizontal aria-hidden />, onClick: onFitWidth }] : []),
                ...(onFitPage ? [{ id: "fit-page", label: t("office.status.fitPage"), icon: <Maximize aria-hidden />, onClick: onFitPage }] : []),
              ]}
            />
            <div data-testid="pdf-status-zoom">
              <OfficeStatusZoom
                value={Math.round(zoom * 100)}
                min={Math.round(minZoom * 100)}
                max={Math.round(maxZoom * 100)}
                onZoomIn={onZoomChange ? () => changeZoom(ZOOM_STEP) : undefined}
                onZoomOut={onZoomChange ? () => changeZoom(-ZOOM_STEP) : undefined}
                onReset={onZoomChange ? () => onZoomChange(1) : undefined}
              />
            </div>
          </div>
        }
        help={help}
      />
    </div>
  );
}
