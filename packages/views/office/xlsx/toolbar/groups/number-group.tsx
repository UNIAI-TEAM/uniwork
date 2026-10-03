"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../types";

export function XlsxNumberGroup({ readOnly = false, canFormat, onNumberFormat }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  return (
    <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.commands.numberFormat")} aria-disabled={readOnly || !canFormat || undefined} title="0.00" onClick={onNumberFormat}>
      <span aria-hidden className="text-caption font-semibold">123</span>
    </Button>
  );
}
