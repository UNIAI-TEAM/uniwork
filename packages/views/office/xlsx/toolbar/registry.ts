import { xlsxEditingRibbonItems } from "./clear/clear-group";
import { xlsxClipboardRibbonItems } from "./groups/clipboard-group";
import { xlsxAlignmentRibbonItems } from "./home-alignment";
import { xlsxCellsRibbonItems } from "./home-cells";
import { xlsxFontRibbonItems } from "./home-font";
import { xlsxNumberRibbonItems } from "../number-format/number-format-group";
import { XlsxPageSetupGroup } from "./page-setup-group";
import { XlsxProtectGroup } from "./protect-group";
import { XlsxSortGroup } from "./sort-group";
import { XlsxTableGroup } from "./table-group";
import { XlsxLinksGroup } from "./links-group";
import { XlsxIllustrationsGroup } from "../visuals/illustrations-group";
import { XlsxFilterGroup } from "./filter-group";
import { XlsxCalculationGroup } from "./groups/calculation-group";
import { XlsxChartsGroup } from "./groups/charts-group";
import { XlsxFormulaGroup } from "./formula-group";
import { XlsxStructureOutlineGroup } from "./structure-outline";
import { XlsxViewDisplayGroup } from "./view-display";
import { XlsxViewGoToGroup } from "./view-goto";
import { XlsxViewShortcutsGroup } from "./view-shortcuts";
import { XlsxViewZoomGroup } from "./view-zoom";
import { xlsxStylesRibbonItems } from "./styles-group";
import { XlsxDataToolsGroup } from "./data-tools/data-tools-group";
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
 *              controls only; the strip owns the `role="group"` wrapper. It is
 *              mounted as ONE custom ribbon item that cannot shrink.
 *  - `ribbonItems` (instead of `Component`) returns typed ribbon items; prefer
 *              it, so the ribbon can shrink the group item by item.
 *  - `isAvailable?` optional predicate; when it returns false the group is not
 *              rendered at all (no label). Read-only/selection states belong on
 *              the controls as `aria-disabled`, not here.
 *
 *  This file is shared by every Wave A worker: edit it LAST, re-read it right
 *  before editing, and append only - never reorder or edit another task's row. */
export const XLSX_TOOLBAR_GROUPS: readonly XlsxToolbarGroupDefinition[] = [
  // Home, in Excel order: Clipboard | Font | Alignment | Number | Conditional format | Cells | Editing.
  // Each is typed ribbon items so the shared ribbon shrinks it item by item.
  { id: "clipboard", tab: "home", order: 30, labelKey: "office.xlsx.toolbar.groups.clipboard", ribbonItems: xlsxClipboardRibbonItems },
  { id: "font", tab: "home", order: 50, labelKey: "office.xlsx.toolbar.groups.font.label", ribbonItems: xlsxFontRibbonItems },
  { id: "alignment", tab: "home", order: 60, labelKey: "office.xlsx.toolbar.groups.alignment.label", ribbonItems: xlsxAlignmentRibbonItems },
  { id: "number", tab: "home", order: 70, labelKey: "office.xlsx.toolbar.groups.number", ribbonItems: xlsxNumberRibbonItems },
  { id: "cells", tab: "home", order: 80, labelKey: "office.xlsx.toolbar.groups.cells", ribbonItems: xlsxCellsRibbonItems },
  { id: "editing", tab: "home", order: 85, labelKey: "office.xlsx.toolbar.groups.editing", ribbonItems: xlsxEditingRibbonItems },
  { id: "charts", tab: "insert", order: 10, labelKey: "office.xlsx.toolbar.groups.charts", Component: XlsxChartsGroup },
  {
    id: "calculation",
    tab: "formulas",
    order: 10,
    labelKey: "office.xlsx.toolbar.groups.calculation",
    Component: XlsxCalculationGroup,
    isAvailable: ({ canRecalculate }) => canRecalculate,
  },
  // Design review X3: Data in Excel's order - Sort & Filter | Data Tools | Outline.
  { id: "structure-outline", tab: "data", order: 50, labelKey: "office.xlsx.structure.groups.outline", Component: XlsxStructureOutlineGroup },
  { id: "view-zoom", tab: "view", order: 10, labelKey: "office.xlsx.toolbar.groups.view.zoom.label", Component: XlsxViewZoomGroup },
  { id: "view-display", tab: "view", order: 20, labelKey: "office.xlsx.toolbar.groups.view.display.label", Component: XlsxViewDisplayGroup },
  { id: "view-goto", tab: "view", order: 30, labelKey: "office.xlsx.toolbar.groups.view.goto.label", Component: XlsxViewGoToGroup },
  { id: "filter", tab: "data", order: 20, labelKey: "office.xlsx.filter.groups.data", Component: XlsxFilterGroup },
  { id: "page-setup", tab: "view", order: 40, labelKey: "office.xlsx.pageSetup.groups.view", Component: XlsxPageSetupGroup },
  { id: "sort", tab: "data", order: 10, labelKey: "office.xlsx.sort.groups.data", Component: XlsxSortGroup },
  { id: "view-shortcuts", tab: "view", order: 50, labelKey: "office.xlsx.toolbar.groups.view.shortcuts.label", Component: XlsxViewShortcutsGroup },
  { id: "formula", tab: "formulas", order: 20, labelKey: "office.xlsx.toolbar.groups.formula.label", Component: XlsxFormulaGroup },
  { id: "protect", tab: "review", order: 10, labelKey: "office.xlsx.protect.groups.review", Component: XlsxProtectGroup },
  // Design review X2: Insert opens with Tables, as in Excel; the row/column
  // insert cluster moved to Home > Cells > Insert rows/columns.
  { id: "table", tab: "insert", order: 5, labelKey: "office.xlsx.table.groups.insert", Component: XlsxTableGroup },
  { id: "links", tab: "insert", order: 40, labelKey: "office.xlsx.links.groups.insert", Component: XlsxLinksGroup },
  // Insert -> Illustrations (UNI-940 X02): Pictures + Shapes, before Charts.
  { id: "illustrations", tab: "insert", order: 8, labelKey: "office.xlsx.visuals.groups.illustrations", Component: XlsxIllustrationsGroup },
  // X01: Home -> Styles (between Number and Cells as in Excel; design review
  // X1 adds Format as Table + Cell Styles beside Conditional Formatting) and
  // Data -> Data Tools (Data Validation).
  { id: "conditional-format", tab: "home", order: 75, labelKey: "office.xlsx.conditionalFormat.groups.home", ribbonItems: xlsxStylesRibbonItems },
  { id: "data-validation", tab: "data", order: 40, labelKey: "office.xlsx.dataValidation.groups.data", Component: XlsxDataToolsGroup },
];

