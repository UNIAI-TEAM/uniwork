"use client";

// C1 (UNI-924): honest guidance for PDF export. No docx->pdf engine op is
// bound (the conversion pipeline only carries xls->xlsx and odt->docx), so the
// dialog explains the browser's own route — Print, then "Save as PDF" as the
// printer — and offers the print dialog directly instead of faking a file.

import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";

export interface DocxExportPdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the browser print dialog; the caller keeps the guidance open state. */
  onPrint: () => void;
}

export function DocxExportPdfDialog({ open, onOpenChange, onPrint }: DocxExportPdfDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="docx-export-pdf-dialog" closeLabel={t("common.close")} className="gap-3">
        <DialogHeader className="gap-1">
          <DialogTitle>{t("office.docx.export.pdf.title")}</DialogTitle>
          <DialogDescription>{t("office.docx.export.pdf.description")}</DialogDescription>
        </DialogHeader>
        <p className="text-body text-muted-foreground">{t("office.docx.export.pdf.hint")}</p>
        <DialogFooter className="flex-row items-center justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button type="button" onClick={() => onPrint()} data-testid="docx-export-pdf-print">
            {t("office.docx.export.pdf.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
