import { createElement, type ReactNode } from "react";
import type { RibbonCustomItem, RibbonGroup, RibbonTab } from "../../ribbon";
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
    render: () => renderGroup(group, context),
  };
  return {
    id: group.id,
    labelKey: group.labelKey,
    priority: xlsxGroupPriority(group.order),
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
  return XLSX_TOOLBAR_TABS.map((tab) => {
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
}