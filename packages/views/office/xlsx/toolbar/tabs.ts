import type { XlsxToolbarTabDefinition } from "./types";

/** Left-to-right tab order. Excel's tab row order, minus Page Layout (its
 *  commands belong to the C2 page-setup task). */
export const XLSX_TOOLBAR_TABS: readonly XlsxToolbarTabDefinition[] = [
  { id: "home", labelKey: "office.xlsx.toolbar.tabs.home" },
  { id: "insert", labelKey: "office.xlsx.toolbar.tabs.insert" },
  { id: "formulas", labelKey: "office.xlsx.toolbar.tabs.formulas" },
  { id: "data", labelKey: "office.xlsx.toolbar.tabs.data" },
  { id: "review", labelKey: "office.xlsx.toolbar.tabs.review" },
  { id: "view", labelKey: "office.xlsx.toolbar.tabs.view" },
];