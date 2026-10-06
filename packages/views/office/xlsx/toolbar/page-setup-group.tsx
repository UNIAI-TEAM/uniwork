"use client";

// C2 (UNI-926): View-tab page-setup group. Page Setup opens the editor-owned
// dialog; Print and Export CSV are host actions the editor wires (print =
// the injected print port, UNI-952; export = a CSV download of the active
// sheet). Page Setup and Export CSV stay in the tab order and inert without a
// mounted grid, a handler or edit rights, like every other group; Print is
// not rendered at all without a handler (a host that cannot print).

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
        {onPrint ? (
          <XlsxGroupRow>
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              className={XLSX_ICON_BUTTON_CLASS}
              aria-label={t("office.common.print")}
              title={t("office.common.print")}
              data-testid="xlsx-print"
              onClick={onPrint}
            >
              <Printer aria-hidden />
            </Button>
          </XlsxGroupRow>
        ) : null}
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
