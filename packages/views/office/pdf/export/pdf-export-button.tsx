"use client";

import { useCallback, useState } from "react";
import { FileDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PdfCanvasPage, PdfPageRenderService } from "../canvas";
import { DEFAULT_PDF_EXPORT_SCALE, exportPdfPages } from "./exporter";
import type { PdfPageExportFile, PdfPageExportProgress, PdfPageSaver } from "./types";

export interface PdfExportButtonProps {
  renderer: PdfPageRenderService;
  pages: readonly PdfCanvasPage[];
  fileBaseName?: string;
  scale?: number;
  /** Delivery seam; defaults to the browser anchor download. */
  savePage?: PdfPageSaver;
  disabled?: boolean;
  className?: string;
  onExported?: (files: readonly PdfPageExportFile[]) => void;
}

/** Export every page as a PNG through the host render seam, one file per
 * page, with progress while the pages render. */
export function PdfExportButton({ renderer, pages, fileBaseName, scale = DEFAULT_PDF_EXPORT_SCALE, savePage, disabled = false, className, onExported }: PdfExportButtonProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<PdfPageExportProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const exporting = progress !== null;

  const exportPages = useCallback(async () => {
    setFailed(false);
    setProgress({ page: 1, total: pages.length });
    try {
      const files = await exportPdfPages({ renderer, pages, fileBaseName, scale, savePage, onProgress: setProgress });
      onExported?.(files);
    } catch {
      setFailed(true);
    } finally {
      setProgress(null);
    }
  }, [fileBaseName, onExported, pages, renderer, savePage, scale]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button type="button" variant="toolbar" size="sm" aria-label={t("office.pdf.export.pages")} aria-busy={exporting || undefined} disabled={disabled || exporting || pages.length === 0} onClick={() => void exportPages()}>
        <FileDown aria-hidden />
        {t("office.pdf.export.pages")}
      </Button>
      {exporting ? <span role="status" aria-live="polite" className="text-caption text-muted-foreground" data-testid="pdf-export-progress">{t("office.pdf.export.progress", { page: progress.page, total: progress.total })}</span> : null}
      {failed ? <p role="alert" className="text-caption text-destructive" data-testid="pdf-export-error">{t("office.pdf.export.failed")}</p> : null}
    </div>
  );
}
