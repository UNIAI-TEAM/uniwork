"use client";

import { Grid3X3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../types";
import { XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows } from "../group-layout";

export function XlsxSheetsGroup({ onShowSheets }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  return (
    <XlsxGroupBody>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button type="button" variant="toolbar" size="icon-sm" className={XLSX_ICON_BUTTON_CLASS} aria-label={t("office.xlsx.commands.sheets")} title={t("office.xlsx.commands.sheets")} onClick={onShowSheets}>
            <Grid3X3 aria-hidden />
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
