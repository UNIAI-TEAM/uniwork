"use client";

import { Calculator } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../types";

export function XlsxCalculationGroup({ readOnly = false, onRecalculate }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  return (
    <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.actions.recalculate")} aria-disabled={readOnly || undefined} onClick={onRecalculate}>
      <Calculator aria-hidden />
    </Button>
  );
}
