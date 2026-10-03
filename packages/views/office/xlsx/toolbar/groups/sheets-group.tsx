"use client";

import { Grid3X3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../types";

export function XlsxSheetsGroup({ onShowSheets }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  return (
    <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.commands.sheets")} onClick={onShowSheets}>
      <Grid3X3 aria-hidden />
    </Button>
  );
}
