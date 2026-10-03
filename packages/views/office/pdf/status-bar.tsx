"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export interface PdfStatusBarProps {
  currentPage: number;
  totalPages: number;
  zoom: number;
  onPageChange?: (page: number) => void;
  onZoomChange?: (zoom: number) => void;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
}

export function PdfStatusBar({ currentPage, totalPages, zoom, onPageChange, onZoomChange, className, minZoom = 0.25, maxZoom = 4 }: PdfStatusBarProps) {
  const { t, i18n } = useTranslation();
  const vi = i18n.language.startsWith("vi");
  const copy = (key: string, english: string, vietnamese: string, values?: Record<string, unknown>) => t(key, { ...values, defaultValue: vi ? vietnamese : english });
  const safeTotal = Math.max(0, Math.trunc(totalPages));
  const safePage = safeTotal === 0 ? 0 : Math.min(Math.max(1, Math.trunc(currentPage)), safeTotal);
  const percent = Math.round(zoom * 100);
  const changeZoom = (delta: number) => onZoomChange?.(Math.min(maxZoom, Math.max(minZoom, Number((zoom + delta).toFixed(2)))));

  return (
    <footer className={cn("flex min-h-9 items-center justify-between gap-3 border-t border-border bg-muted/30 px-3 py-1 text-caption text-muted-foreground", className)} data-testid="pdf-status-bar" aria-label={copy("office.pdf.statusBar.label", "PDF status bar", "Thanh trạng thái PDF")}>
      <div className="flex items-center gap-2" data-testid="pdf-page-position">
        <span>{copy("office.pdf.statusBar.page", "Page {{page}} / {{total}}", "Trang {{page}} / {{total}}", { page: safePage, total: safeTotal })}</span>
        {onPageChange ? <input aria-label={copy("office.pdf.statusBar.pageInput", "Current page", "Trang hiện tại")} className="h-7 w-14 rounded-control border border-input bg-background px-1 text-center text-body text-foreground" type="number" min={safeTotal ? 1 : 0} max={safeTotal || undefined} value={safePage} onChange={(event) => onPageChange(Number(event.target.value))} /> : null}
      </div>
      <div className="flex items-center gap-1" data-testid="pdf-zoom">
        {onZoomChange ? <Button type="button" variant="ghost" size="icon-sm" aria-label={copy("office.pdf.statusBar.zoomOut", "Zoom out", "Thu nhỏ")} onClick={() => changeZoom(-0.1)} disabled={zoom <= minZoom}><Minus aria-hidden /></Button> : null}
        <span className="min-w-12 text-center">{copy("office.pdf.statusBar.zoom", "{{percent}}%", "{{percent}}%", { percent })}</span>
        {onZoomChange ? <Button type="button" variant="ghost" size="icon-sm" aria-label={copy("office.pdf.statusBar.zoomIn", "Zoom in", "Phóng to")} onClick={() => changeZoom(0.1)} disabled={zoom >= maxZoom}><Plus aria-hidden /></Button> : null}
      </div>
    </footer>
  );
}
