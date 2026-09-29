"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { PdfPage } from "./types";

export interface PdfPagePanelProps {
  pages: readonly PdfPage[];
  selectedPage: number | null;
  disabled?: boolean;
  onSelect: (page: number) => void;
  onReorder?: (page: number, index: number) => void;
  onExtract?: (page: number) => void;
}

export function PdfPagePanel({ pages, selectedPage, disabled = false, onSelect, onReorder, onExtract }: PdfPagePanelProps) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-48 shrink-0 flex-col gap-2 border-r border-border bg-muted/10 p-2" aria-label={t("office.pdf.pages.label")} data-testid="pdf-page-panel">
      <h2 className="px-1 text-label font-medium">{t("office.pdf.pages.title")}</h2>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto" role="list">
        {pages.map((page) => (
          <div key={page.pageNumber} className="space-y-1" role="listitem">
            <Button type="button" variant={selectedPage === page.pageNumber ? "secondary" : "ghost"} size="sm" className="h-auto min-h-10 w-full justify-start" aria-current={selectedPage === page.pageNumber ? "page" : undefined} disabled={disabled} onClick={() => onSelect(page.pageNumber)}>
              {page.previewUrl ? <img src={page.previewUrl} alt="" className="h-8 w-6 object-cover" /> : null}
              <span>{t("office.pdf.pages.page", { page: page.pageNumber })}</span>
            </Button>
            {selectedPage === page.pageNumber && !disabled ? (
              <div className="flex gap-1 pl-1">
                <Button type="button" variant="outline" size="xs" onClick={() => onReorder?.(page.pageNumber, Math.max(0, page.pageNumber - 2))}>{t("office.pdf.pages.moveUp")}</Button>
                <Button type="button" variant="outline" size="xs" onClick={() => onExtract?.(page.pageNumber)}>{t("office.pdf.pages.extract")}</Button>
              </div>
            ) : null}
          </div>
        ))}
        {pages.length === 0 ? <p className="px-1 text-caption text-muted-foreground">{t("office.pdf.pages.empty")}</p> : null}
      </div>
    </aside>
  );
}
