import { createElement, type ReactNode } from "react";
import type { RibbonCustomItem, RibbonGroup, RibbonTab } from "../../ribbon";
import type { AvailabilityAwareGroup } from "./groups/insert-header-footer";
import { DOCX_TOOLBAR_TABS } from "./tabs/tabs";
import type { DocxToolbarGroup, DocxToolbarGroupContext } from "./types";

/**
 * R8 (chrome amendment R): the DOCX command row is the shared Office ribbon.
 * This module re-mounts the existing per-tab registry (./tabs/tabs.ts) 1:1 -
 * every tab keeps its id and labelKey, every group keeps its id, labelKey and
 * component and becomes ONE custom ribbon item, so no command can disappear in
 * the migration. `DOCX_TOOLBAR_TABS` stays the single source of truth.
 */

/**
 * Priority for a group whose registry entry carries no `collapseAt`. Mapped
 * groups take `-collapseAt` (<= 0, larger widths collapse first), so a small
 * positive default keeps an unmeasured group visible longest: it collapses
 * only after every group that declares a width.
 */
export const DOCX_GROUP_PRIORITY_DEFAULT = 10;

/** `collapseAt` is a container width (bigger = collapses earlier); the ribbon
 * orders by ascending `priority`, so the mapping flips the sign. */
export function docxGroupPriority(collapseAt?: number): number {
  return collapseAt === undefined ? DOCX_GROUP_PRIORITY_DEFAULT : -collapseAt;
}

/** Fallback custom-item width when a group has no entry in GROUP_WIDTHS. */
const GROUP_WIDTH_DEFAULT = 96;

/**
 * Estimated full-size width (px) of each group's command area. The ribbon uses
 * it for adaptive collapse (a custom item stands alone as one block) and
 * corrects the estimate against the rendered row, so these are approximations
 * from the controls each group mounts, not measured values.
 */
const GROUP_WIDTHS: Readonly<Record<string, number>> = {
  "home-font": 430,
  "home-lists": 90,
  "home-paragraph": 230,
  "home-styles": 170,
  "insert-links": 60,
  "insert-table": 70,
  "insert-image": 110,
  "insert-symbols": 150,
  "insert-shapes": 90,
  "insert-notes": 120,
  "insert-chart": 110,
  "insert-toc": 60,
  "insert-captions": 60,
  "insert-header-footer": 50,
  "layout-page-setup": 40,
  "layout-page-decor": 40,
  "review-track-changes": 50,
  "review-comments": 50,
  "review-compare": 50,
  "review-protect": 110,
  "view-zoom": 150,
  "view-navigation": 50,
  export: 50,
};

/**
 * Renders one group component, honouring the availability contract the old
 * command-row shell enforced: a group that declares its area absent for this
 * context renders nothing instead of an empty labelled box.
 */
function renderGroup(group: DocxToolbarGroup, context: DocxToolbarGroupContext): ReactNode {
  const Group = group.component as AvailabilityAwareGroup;
  if (Group.isAvailable && !Group.isAvailable(context)) return null;
  return createElement(Group, context);
}

function toRibbonGroup(group: DocxToolbarGroup, context: DocxToolbarGroupContext): RibbonGroup {
  const item: RibbonCustomItem = {
    kind: "custom",
    id: group.id,
    labelKey: group.labelKey,
    width: GROUP_WIDTHS[group.id] ?? GROUP_WIDTH_DEFAULT,
    render: () => renderGroup(group, context),
  };
  return {
    id: group.id,
    labelKey: group.labelKey,
    priority: docxGroupPriority(group.collapseAt),
    items: [item],
  };
}

/** The DOCX tabs as shared-ribbon data, bound to one toolbar context. */
export function buildDocxRibbonTabs(context: DocxToolbarGroupContext): readonly RibbonTab[] {
  return DOCX_TOOLBAR_TABS.map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    groups: tab.groups.map((group) => toRibbonGroup(group, context)),
  }));
}