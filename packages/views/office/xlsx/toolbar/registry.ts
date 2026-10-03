import { XlsxCalculationGroup } from "./groups/calculation-group";
import { XlsxChartsGroup } from "./groups/charts-group";
import { XlsxClipboardGroup } from "./groups/clipboard-group";
import { XlsxHistoryGroup } from "./groups/history-group";
import { XlsxNumberGroup } from "./groups/number-group";
import { XlsxSheetsGroup } from "./groups/sheets-group";
import { XlsxAlignmentGroup } from "./home-alignment";
import { XlsxBordersGroup } from "./home-borders";
import { XlsxFontGroup } from "./home-font";
import type { XlsxToolbarGroupDefinition } from "./types";

/** The extension seam for Wave A tasks (A1-A9): add ONE group to ONE tab by
 *  importing your group component and appending ONE entry here.
 *
 *  - `id`      unique across the registry (also the measurement key).
 *  - `tab`     one of the six tab ids in `types.ts`.
 *  - `order`   ascending inside the tab; when the strip runs out of width the
 *              trailing (highest) orders collapse into the overflow panel
 *              first, so give the most-used group the lowest order.
 *  - `labelKey` a key under `office.xlsx.toolbar.groups.*` in BOTH locales;
 *              it is the group's visible and accessible name.
 *  - `Component` takes `XlsxToolbarGroupProps` and renders the group's
 *              controls only; the strip owns the `role="group"` wrapper.
 *  - `isAvailable?` optional predicate; when it returns false the group is not
 *              rendered at all (no label). Read-only/selection states belong on
 *              the controls as `aria-disabled`, not here.
 *
 *  This file is shared by every Wave A worker: edit it LAST, re-read it right
 *  before editing, and append only — never reorder or edit another task's row. */
export const XLSX_TOOLBAR_GROUPS: readonly XlsxToolbarGroupDefinition[] = [
  { id: "history", tab: "home", order: 10, labelKey: "office.xlsx.toolbar.groups.history", Component: XlsxHistoryGroup },
  { id: "sheets", tab: "home", order: 20, labelKey: "office.xlsx.toolbar.groups.sheets", Component: XlsxSheetsGroup },
  { id: "clipboard", tab: "home", order: 30, labelKey: "office.xlsx.toolbar.groups.clipboard", Component: XlsxClipboardGroup },
  { id: "number", tab: "home", order: 40, labelKey: "office.xlsx.toolbar.groups.number", Component: XlsxNumberGroup },
  { id: "font", tab: "home", order: 50, labelKey: "office.xlsx.toolbar.groups.font.label", Component: XlsxFontGroup },
  { id: "alignment", tab: "home", order: 60, labelKey: "office.xlsx.toolbar.groups.alignment.label", Component: XlsxAlignmentGroup },
  { id: "borders", tab: "home", order: 70, labelKey: "office.xlsx.toolbar.groups.borders.label", Component: XlsxBordersGroup },
  { id: "charts", tab: "insert", order: 10, labelKey: "office.xlsx.toolbar.groups.charts", Component: XlsxChartsGroup },
  {
    id: "calculation",
    tab: "formulas",
    order: 10,
    labelKey: "office.xlsx.toolbar.groups.calculation",
    Component: XlsxCalculationGroup,
    isAvailable: ({ canRecalculate }) => canRecalculate,
  },
];
