"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

export interface PdfThumbnailPage {
  pageNumber: number;
  label?: string;
}

export interface PdfThumbnailsRailProps {
  pages: readonly PdfThumbnailPage[];
  activePage?: number;
  onSelect?: (pageNumber: number) => void;
  /** A host may supply a rendered thumbnail; without one the rail draws a
   * numbered placeholder so the structure stays testable and offline-safe. */
  renderThumbnail?: (page: PdfThumbnailPage) => ReactNode;
  className?: string;
}

/**
 * The left page rail for the PDF chrome (C11). Purely presentational: it lists
 * pages, highlights the active one and reports selection upward. No engine or
 * renderer import — the host injects one through `renderThumbnail`.
 */
export function PdfThumbnailsRail({
  pages,
  activePage,
  onSelect,
  renderThumbnail,
  className,
}: PdfThumbnailsRailProps) {
  const { t } = useTranslation();
  return (
    <aside
      className={cn("flex w-36 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-muted/10 p-2", className)}
      aria-label={t("office.pdf.chrome.thumbnailsLabel")}
      data-testid="pdf-thumbnails-rail"
    >
      {pages.map((page) => {
        const active = page.pageNumber === activePage;
        const label = page.label ?? t("office.pdf.chrome.thumbnailPage", { page: page.pageNumber });
        return (
          <button
            key={page.pageNumber}
            type="button"
            aria-label={label}
            aria-current={active ? "page" : undefined}
            data-testid={`pdf-thumbnail-${page.pageNumber}`}
            data-active={active ? "true" : undefined}
            onClick={() => onSelect?.(page.pageNumber)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-control border p-1 text-caption transition-colors pointer-coarse:min-h-11",
              "border-transparent hover:bg-surface-hover",
              active ? "border-brand bg-surface-selected text-surface-selected-foreground" : "text-muted-foreground",
            )}
          >
            {renderThumbnail ? (
              renderThumbnail(page)
            ) : (
              <span
                className="flex aspect-[3/4] w-full items-center justify-center rounded-sm border border-border bg-background text-body tabular-nums"
                data-testid={`pdf-thumbnail-placeholder-${page.pageNumber}`}
                aria-hidden
              >
                {page.pageNumber}
              </span>
            )}
            <span className="tabular-nums">{label}</span>
          </button>
        );
      })}
    </aside>
  );
}
