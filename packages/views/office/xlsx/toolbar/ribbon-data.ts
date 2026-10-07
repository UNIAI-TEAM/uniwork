import { createElement, type ReactNode } from "react";
import {
  ArrowDownUp,
  Image,
  ListChecks,
  Palette,
  BetweenHorizontalStart,
  ChartColumn,
  Clipboard,
  Eraser,
  Eye,
  Filter,
  Hash,
  Keyboard,
  Link2,
  ListTree,
  Navigation,
  Printer,
  Rows3,
  ShieldCheck,
  Sigma,
  SquareFunction,
  Table2,
  Type,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import type { RibbonCustomItem, RibbonGroup, RibbonItem, RibbonTab } from "../../ribbon";
import { xlsxContextualTabs } from "./contextual-tabs";
import { XlsxEmptyTabGroup } from "./empty-tab-group";
import { XLSX_TOOLBAR_GROUPS } from "./registry";
import { XLSX_TOOLBAR_TABS } from "./tabs";
import type { XlsxToolbarGroupDefinition, XlsxToolbarGroupProps } from "./types";

/**
 * Chrome amendment R (UNI-926): the XLSX command row is the SHARED Office
 * ribbon. This module re-mounts the existing registry (./registry.ts) 1:1 -
 * every tab keeps its id and labelKey, every group keeps its id, labelKey and
 * component (or typed `ribbonItems`) and becomes either ONE custom ribbon item
 * or the typed items, so no command, op or journal path can disappear in the
 * migration. `XLSX_TOOLBAR_TABS` and
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
  clipboard: Clipboard,
  number: Hash,
  font: Type,
  alignment: BetweenHorizontalStart,
  cells: Rows3,
  editing: Eraser,
  charts: ChartColumn,
  calculation: Sigma,
  formula: SquareFunction,
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
  "conditional-format": Palette,
  "data-validation": ListChecks,
  illustrations: Image,
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
  charts: 36,
  calculation: 104,
  formula: 40,
  // Group + Ungroup + Subtotal (large) + Show/Hide Detail.
  "structure-outline": 296,
  filter: 180,
  sort: 216,
  // Text to Columns + Remove Duplicates (large) + the Data Validation group.
  "data-validation": 344,
  "page-setup": 72,
  protect: 104,
  table: 72,
  links: 152,
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
function renderGroup(Component: NonNullable<XlsxToolbarGroupDefinition["Component"]>, context: XlsxToolbarGroupProps): ReactNode {
  return createElement(Component, context);
}

/** A group's items: its typed `ribbonItems` when it declares them (the ribbon
 *  shrinks those item by item), else ONE custom item hosting its component
 *  (it cannot shrink, so the ribbon folds the whole group). */
function itemsFor(group: XlsxToolbarGroupDefinition, context: XlsxToolbarGroupProps): readonly RibbonItem[] {
  if (group.ribbonItems) return group.ribbonItems(context);
  const Component = group.Component;
  if (!Component) return [];
  const item: RibbonCustomItem = {
    kind: "custom",
    id: group.id,
    labelKey: group.labelKey,
    width: XLSX_GROUP_WIDTHS[group.id] ?? XLSX_GROUP_WIDTH_DEFAULT,
    render: () => renderGroup(Component, context),
  };
  return [item];
}

/** Groups made only of dropdown menus: their collapsed panel needs no repeated
 *  group caption under the menu buttons. */
const XLSX_MENU_ONLY_GROUPS: ReadonlySet<string> = new Set(["cells"]);

function toRibbonGroup(group: XlsxToolbarGroupDefinition, context: XlsxToolbarGroupProps): RibbonGroup {
  return {
    id: group.id,
    labelKey: group.labelKey,
    priority: xlsxGroupPriority(group.order),
    ...(XLSX_MENU_ONLY_GROUPS.has(group.id) ? { panelCaption: false } : {}),
    ...(XLSX_GROUP_ICONS[group.id] === undefined ? {} : { icon: XLSX_GROUP_ICONS[group.id] }),
    items: itemsFor(group, context),
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
