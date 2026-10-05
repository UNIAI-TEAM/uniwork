import { createElement, type ReactNode } from "react";
import {
  ArrowDownUp,
  BetweenHorizontalStart,
  ChartColumn,
  Clipboard,
  Columns3,
  Eraser,
  Eye,
  Filter,
  Grid3X3,
  Hash,
  Keyboard,
  Link2,
  ListTree,
  Navigation,
  Paintbrush,
  Printer,
  Rows3,
  Search,
  ShieldCheck,
  Sigma,
  Square,
  SquareFunction,
  Table2,
  TableCellsMerge,
  Type,
  Undo2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import type { RibbonCustomItem, RibbonGroup, RibbonTab } from "../../ribbon";
import { xlsxContextualTabs } from "./contextual-tabs";
import { XlsxEmptyTabGroup } from "./empty-tab-group";
import { XLSX_TOOLBAR_GROUPS } from "./registry";
import { XLSX_TOOLBAR_TABS } from "./tabs";
import type { XlsxToolbarGroupDefinition, XlsxToolbarGroupProps } from "./types";

/**
 * Chrome amendment R (UNI-926): the XLSX command row is the SHARED Office
 * ribbon. This module re-mounts the existing registry (./registry.ts) 1:1 -
 * every tab keeps its id and labelKey, every group keeps its id, labelKey and
 * component and becomes ONE custom ribbon item, so no command, op or journal
 * path can disappear in the migration. `XLSX_TOOLBAR_TABS` and
 * `XLSX_TOOLBAR_GROUPS` stay the single source of truth.
 */

/** Key of the persisted ribbon-collapse preference for the spreadsheet. */
export const XLSX_RIBBON_SCOPE = "xlsx";

/** Id of the honest empty state the ribbon shows for a tab with no commands
 *  (Review today): the pre-ribbon group strip promised a labelled placeholder
 *  there, so the ribbon body never renders a silently blank strip. */
export const XLSX_EMPTY_TAB_GROUP_ID = "empty-tab";

/**
 * F6 (fix round FIX-CHROME): one DISTINCT icon per ribbon group. Every group
 * mounts as a single custom item whose component owns its own controls, so
 * without an explicit group icon the collapsed group button fell back to the
 * shared four-squares placeholder for every group (Number, Font, Alignment,
 * Borders, Merge cells, Row and column, Clear, Format painter, Find & replace
 * all looked identical). The icon is presentation-only: it never changes a
 * command id, op or the save path.
 */
export const XLSX_GROUP_ICONS: Readonly<Record<string, LucideIcon>> = {
  history: Undo2,
  sheets: Grid3X3,
  clipboard: Clipboard,
  number: Hash,
  font: Type,
  alignment: BetweenHorizontalStart,
  borders: Square,
  "structure-size": Rows3,
  "structure-merge": TableCellsMerge,
  clear: Eraser,
  painter: Paintbrush,
  find: Search,
  charts: ChartColumn,
  calculation: Sigma,
  formula: SquareFunction,
  "structure-insert": Columns3,
  "structure-outline": ListTree,
  "view-zoom": ZoomIn,
  "view-display": Eye,
  "view-goto": Navigation,
  "view-shortcuts": Keyboard,
  filter: Filter,
  sort: ArrowDownUp,
  "page-setup": Printer,
  protect: ShieldCheck,
  table: Table2,
  links: Link2,
};

/**
 * R3 (fix round FIX-R3R4): the estimated full-size width (px) of each group's
 * command area. Every XLSX group mounts as ONE `custom` ribbon item; without a
 * declared width the layout estimator assumed the 96 px default for all of
 * them, so the estimate never matched the rendered row, `planRibbonStages`
 * thought everything fit, and the real row overflowed with a scrollbar and
 * clipped labels (visual r2 R3). These estimates are approximations from the
 * controls each group mounts (corrected at runtime by the ribbon's
 * scrollWidth pass); with them the collapse walks large -> small -> icon -> one
 * button in declared priority order from the right, as the amendment requires.
 */
export const XLSX_GROUP_WIDTHS: Readonly<Record<string, number>> = {
  sheets: 36,
  clipboard: 72,
  number: 132,
  font: 414,
  alignment: 360,
  borders: 72,
  "structure-merge": 104,
  "structure-size": 228,
  clear: 64,
  painter: 36,
  history: 72,
  find: 36,
  charts: 36,
  calculation: 104,
  formula: 40,
  "structure-insert": 264,
  "structure-outline": 132,
  filter: 132,
  sort: 104,
  "page-setup": 72,
  protect: 104,
  table: 152,
  links: 72,
  "view-zoom": 176,
  "view-display": 140,
  "view-goto": 104,
  "view-shortcuts": 40,
};

/** Fallback for a group with no measured width entry (an unmeasured group). */
const XLSX_GROUP_WIDTH_DEFAULT = 96;

/**
 * `order` ascends by usage inside a tab (10 = most used); the ribbon collapses
 * the LOWEST `priority` first, so `-order` makes the highest (least used)
 * order collapse first - the registry's documented overflow order.
 */
export function xlsxGroupPriority(order: number): number {
  return -order;
}

/** Renders one registry group component verbatim, so its controls, commands
 *  and disabled/read-only semantics are byte-identical to the old strip. */
function renderGroup(group: XlsxToolbarGroupDefinition, context: XlsxToolbarGroupProps): ReactNode {
  return createElement(group.Component, context);
}

function toRibbonGroup(group: XlsxToolbarGroupDefinition, context: XlsxToolbarGroupProps): RibbonGroup {
  const item: RibbonCustomItem = {
    kind: "custom",
    id: group.id,
    labelKey: group.labelKey,
    width: XLSX_GROUP_WIDTHS[group.id] ?? XLSX_GROUP_WIDTH_DEFAULT,
    render: () => renderGroup(group, context),
  };
  return {
    id: group.id,
    labelKey: group.labelKey,
    priority: xlsxGroupPriority(group.order),
    ...(XLSX_GROUP_ICONS[group.id] === undefined ? {} : { icon: XLSX_GROUP_ICONS[group.id] }),
    items: [item],
  };
}

/** The placeholder group for a tab the registry has no commands for. */
function toEmptyTabGroup(): RibbonGroup {
  const item: RibbonCustomItem = {
    kind: "custom",
    id: XLSX_EMPTY_TAB_GROUP_ID,
    labelKey: "office.xlsx.toolbar.emptyTab",
    render: () => createElement(XlsxEmptyTabGroup),
  };
  return {
    id: XLSX_EMPTY_TAB_GROUP_ID,
    labelKey: "office.xlsx.toolbar.emptyTab",
    priority: 0,
    items: [item],
  };
}

/**
 * The XLSX tabs as shared-ribbon data, bound to one toolbar context. Groups
 * keep their registry order inside a tab; a group whose `isAvailable` returns
 * false for this context is omitted entirely (no empty labelled box). A tab
 * left with no groups (Review) keeps the honest empty state instead of a blank
 * ribbon body.
 */
export function xlsxRibbonTabs(context: XlsxToolbarGroupProps): readonly RibbonTab[] {
  const fixed = XLSX_TOOLBAR_TABS.map((tab) => {
    const groups = XLSX_TOOLBAR_GROUPS
      .filter((group) => group.tab === tab.id && (group.isAvailable?.(context) ?? true))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((group) => toRibbonGroup(group, context));
    return {
      id: tab.id,
      labelKey: tab.labelKey,
      groups: groups.length > 0 ? groups : [toEmptyTabGroup()],
    };
  });
  // R4: the contextual Table tabs ride after the fixed tabs; OfficeRibbon
  // renders them only while `when` is true (selection inside a table), so the
  // fixed tabs never move.
  return [...fixed, ...xlsxContextualTabs(context)];
}
