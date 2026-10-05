"use client";

// C2 (UNI-926): View-tab page-setup group. Page Setup opens the editor-owned
// dialog; Print and Export CSV are host actions the editor wires (print =
// the browser's print dialog, export = a CSV download of the active sheet).
// The three controls stay in the tab order and inert without a mounted grid,
// a handler or edit rights, like every other group.

import { FileDown, Printer, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  XLSX_ICON_BUTTON_CLASS,
  XlsxGroupBody,
  XlsxGroupRow,
  XlsxGroupRows,
  XlsxLargeButton,
  XlsxLargeLabel,
} from "./group-layout";
import type { XlsxToolbarGroupProps } from "./types";

export function XlsxPageSetupGroup({
  readOnly = false,
  onOpenPageSetup,
  onPrint,
  onExportCsv,
}: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.pageSetup.open")}
        title={t("office.xlsx.pageSetup.open")}
        aria-haspopup="dialog"
        aria-disabled={readOnly || !onOpenPageSetup || undefined}
        data-testid="xlsx-page-setup-open"
        onClick={() => { if (!readOnly && onOpenPageSetup) onOpenPageSetup(); }}
      >
        <Settings2 aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.pageSetup.open")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            aria-label={t("office.xlsx.export.print")}
            title={t("office.xlsx.export.print")}
            aria-disabled={!onPrint || undefined}
            data-testid="xlsx-print"
            onClick={() => { if (onPrint) onPrint(); }}
          >
            <Printer aria-hidden />
          </Button>
        </XlsxGroupRow>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            aria-label={t("office.xlsx.export.csv")}
            title={t("office.xlsx.export.csv")}
            aria-disabled={!onExportCsv || undefined}
            data-testid="xlsx-export-csv"
            onClick={() => { if (onExportCsv) onExportCsv(); }}
          >
            <FileDown aria-hidden />
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
