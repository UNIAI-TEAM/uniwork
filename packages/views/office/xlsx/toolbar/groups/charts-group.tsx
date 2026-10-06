"use client";

import { ChartArea, ChartBar, ChartColumn, ChartLine, ChartPie, Donut, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { XlsxVisualChartType } from "@uniwork/office-engine/xlsx";
import { XlsxGroupBody } from "../group-layout";
import { XlsxVisualMenu } from "../../visuals/visual-menu";
import { useXlsxVisualsCommands } from "../../visuals/visuals-context";

const CHART_TYPES: readonly { readonly type: XlsxVisualChartType; readonly icon: LucideIcon }[] = [
  { type: "column", icon: ChartColumn },
  { type: "bar", icon: ChartBar },
  { type: "line", icon: ChartLine },
  { type: "area", icon: ChartArea },
  { type: "pie", icon: ChartPie },
  { type: "doughnut", icon: Donut },
];

/** Insert > Charts (UNI-940 X02): a chart of the chosen type from the selected
 *  range, drawn in the editor's visual overlay and saved as xl/charts parts.
 *  Without a live grid or a multi-cell selection the menu stays unavailable. */
export function XlsxChartsGroup() {
  const { t } = useTranslation();
  const visuals = useXlsxVisualsCommands();
  const blocked = !visuals?.canInsertChart;
  const reason = !visuals?.available ? t("office.xlsx.capabilityPending") : t("office.xlsx.visuals.chart.needsRange");
  return (
    <XlsxGroupBody>
      <XlsxVisualMenu
        id="chart"
        labelKey="office.xlsx.commands.chart"
        icon={ChartColumn}
        blocked={blocked}
        blockedReason={reason}
        entries={CHART_TYPES.map(({ type, icon }) => ({
          id: type,
          icon,
          label: t(`office.xlsx.visuals.chartTypes.${type}`),
          onSelect: () => visuals?.insertChart(type),
        }))}
      />
    </XlsxGroupBody>
  );
}
