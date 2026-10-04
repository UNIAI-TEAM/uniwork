"use client";

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
import { DocxHeaderFooterPanel, type DocxHeaderFooterPanelProps } from "./docx-header-footer-panel";

export interface DocxHeaderFooterDialogProps extends DocxHeaderFooterPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Task A13: the header/footer editing panel in a dialog. Inline on-canvas
 * editing is not reachable from this seam — the canvas strips are built
 * imperatively by the vendored paginator (makeGapHfEl), which owns no React
 * surface — so the honest editor is this dialog over the same slot ops.
 */
export function DocxHeaderFooterDialog({ open, onOpenChange, ...panel }: DocxHeaderFooterDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="docx-header-footer-dialog"
        className="gap-3 sm:max-w-lg"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="gap-1">
          <DialogTitle>{t("office.docx.headerFooter.label")}</DialogTitle>
          <DialogDescription>{t("office.docx.headerFooter.description")}</DialogDescription>
        </DialogHeader>
        <DocxHeaderFooterPanel {...panel} />
        <DialogFooter className="flex-row items-center justify-end">
          <Button type="button" variant="outline" data-testid="docx-header-footer-close" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
