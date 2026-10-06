"use client";

import { AlertTriangle, Info, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { Notice } from "../../../common/notice";
import type { PdfPrintController } from "./use-pdf-print";

/** i18next keys the PDF print entries read. The label is the format-neutral
 * Print key every Office format shows in the same place. */
const PDF_PRINT_KEYS = {
  label: "office.common.print",
  preparing: "office.pdf.print.preparing",
  failed: "office.pdf.print.failed",
  busy: "office.pdf.print.busy",
} as const;

interface PdfPrintEntryProps {
  controller: PdfPrintController;
}

/** The PDF toolbar's Print button (ribbon trailing cluster, beside Find). */
export function PdfPrintButton({ controller }: PdfPrintEntryProps) {
  const { t } = useTranslation();
  const { printing } = controller;
  return (
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      className="shrink-0 pointer-coarse:min-h-11"
      data-testid="pdf-print"
      aria-label={t(PDF_PRINT_KEYS.label)}
      aria-busy={printing || undefined}
      disabled={printing}
      onClick={controller.print}
    >
      <Printer aria-hidden />
      <span className="max-sm:sr-only">{printing ? t(PDF_PRINT_KEYS.preparing) : t(PDF_PRINT_KEYS.label)}</span>
    </Button>
  );
}

/** The Print entry the PDF editor contributes to the page header's overflow menu. */
export function PdfPrintMenuItem({ controller }: PdfPrintEntryProps) {
  const { t } = useTranslation();
  const { printing } = controller;
  return (
    <DropdownMenuItem
      className="gap-2 px-2 py-2"
      data-pdf-print
      aria-busy={printing || undefined}
      aria-disabled={printing || undefined}
      onClick={() => {
        if (!printing) controller.print();
      }}
    >
      <Printer aria-hidden className="size-3.5" />
      {printing ? t(PDF_PRINT_KEYS.preparing) : t(PDF_PRINT_KEYS.label)}
    </DropdownMenuItem>
  );
}

/** The outcome of the last run, or nothing: printed and cancelled are silent. */
export function PdfPrintNotice({ controller }: PdfPrintEntryProps) {
  const { t } = useTranslation();
  if (controller.status === "busy") {
    return <div data-testid="pdf-print-busy"><Notice tone="info" icon={Info}>{t(PDF_PRINT_KEYS.busy)}</Notice></div>;
  }
  if (controller.status === "failed") {
    return <div data-testid="pdf-print-error"><Notice tone="destructive" icon={AlertTriangle} live="assertive">{t(PDF_PRINT_KEYS.failed)}</Notice></div>;
  }
  return null;
}
