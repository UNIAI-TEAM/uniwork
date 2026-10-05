"use client";

import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { XlsxGroupBody, XlsxLargeButton, XlsxLargeLabel } from "../group-layout";

/** The one capability-gated placeholder kept from the flat toolbar: charts are
 *  not persisted as workbook ops yet, so the control announces itself
 *  unavailable with the shared reason instead of pretending to work. */
export function XlsxChartsGroup() {
  const { t } = useTranslation();
  return (
    <XlsxGroupBody>
      <XlsxLargeButton aria-label={t("office.xlsx.commands.chart")} aria-disabled title={t("office.xlsx.capabilityPending")}>
        <BarChart3 aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.commands.chart")}</XlsxLargeLabel>
      </XlsxLargeButton>
    </XlsxGroupBody>
  );
}
