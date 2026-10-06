"use client";

// UNI-940 X02: the Insert-tab groups reach the editor's visual wiring through
// this context (the ribbon renders groups from a registry, so the commands
// cannot ride the shared toolbar props without widening every group). Absent
// provider = no live grid: the groups render their controls unavailable.
import { createContext, useContext } from "react";
import type { XlsxVisualChartType, XlsxVisualShapeType } from "@uniwork/office-engine/xlsx";

export interface XlsxVisualsCommands {
  /** False without a live grid, an edit channel, or on a read-only mount. */
  readonly available: boolean;
  /** A chart needs a selected range of at least two cells. */
  readonly canInsertChart: boolean;
  insertChart(chartType: XlsxVisualChartType): void;
  insertShape(shapeType: XlsxVisualShapeType): void;
  /** Opens the local file picker; the chosen picture lands at the active cell. */
  insertPicture(): void;
}

export const XlsxVisualsContext = createContext<XlsxVisualsCommands | null>(null);

export function useXlsxVisualsCommands(): XlsxVisualsCommands | null {
  return useContext(XlsxVisualsContext);
}
