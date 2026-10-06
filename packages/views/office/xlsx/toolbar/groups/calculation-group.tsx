"use client";

import { Calculator } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { XlsxToolbarGroupProps } from "../types";
import { XlsxGroupBody, XlsxLargeButton, XlsxLargeLabel } from "../group-layout";

export function XlsxCalculationGroup({ readOnly = false, onRecalculate }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.actions.recalculate")}
        title={t("office.xlsx.actions.recalculate")}
        aria-disabled={readOnly || undefined}
        onClick={onRecalculate}
      >
        <Calculator aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.actions.recalculate")}</XlsxLargeLabel>
      </XlsxLargeButton>
    </XlsxGroupBody>
  );
}
