import { createElement, type ReactNode } from "react";
import type { RibbonCustomItem, RibbonGroup, RibbonTab } from "../../ribbon";
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

/**
 * The XLSX tabs as shared-ribbon data, bound to one toolbar context. Groups
 * keep their registry order inside a tab; a group whose `isAvailable` returns
 * false for this context is omitted entirely (no empty labelled box).
 */
export function xlsxRibbonTabs(context: XlsxToolbarGroupProps): readonly RibbonTab[] {
  return XLSX_TOOLBAR_TABS.map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    groups: XLSX_TOOLBAR_GROUPS.filter(
      (group) => group.tab === tab.id && (group.isAvailable?.(context) ?? true),
    )
      .slice()
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((group) => toRibbonGroup(group, context)),
  }));
}