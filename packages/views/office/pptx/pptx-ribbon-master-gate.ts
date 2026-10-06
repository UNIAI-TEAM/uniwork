/**
 * The ribbon while the slide master view is open (UNI-939 master_fix3 #1).
 *
 * The canvas shows a master/layout preview, not a deck slide, so any ribbon item
 * that would write the hidden slide has to wait for Close master. Instead of
 * naming the slide-editing items one by one, this is an ALLOWLIST by group: only
 * the groups below stay live (file, views, the master toggle, slide show); every
 * other item - commands, panel toggles (new slide, shapes, header/footer, link,
 * media, ...), the injected Font/Paragraph/Arrange items and the contextual tabs
 * - is disabled with the master-view reason and does nothing when executed.
 * A new group or item is therefore locked by default.
 */
import { createElement } from "react";
import type { RibbonItem, RibbonMenuEntry, RibbonOption, RibbonTab } from "../ribbon";
import { PptxDisabledCombo } from "./ribbon-disabled-combo";

/** i18n key of the tooltip every locked item carries. */
export const PPTX_MASTER_VIEW_REASON = "office.pptx.reasons.master_view";

/** Ribbon groups that stay usable in master view: they do not edit a slide. */
const MASTER_VIEW_LIVE_GROUPS: ReadonlySet<string> = new Set(["file", "views", "master", "show"]);

const noop = (): void => undefined;

const lockMenu = (menu: readonly RibbonMenuEntry[]): RibbonMenuEntry[] => menu.map((entry) => ({ ...entry, disabled: true, onSelect: noop }));

function lockItem(item: RibbonItem): RibbonItem {
  const locked = { disabled: true as const, tooltipKey: PPTX_MASTER_VIEW_REASON };
  switch (item.kind) {
    case "button":
    case "toggle":
      return { ...item, ...locked, onExecute: noop };
    case "split":
      return { ...item, ...locked, onExecute: noop, menu: lockMenu(item.menu) };
    case "dropdown":
      return { ...item, ...locked, menu: lockMenu(item.menu) };
    case "gallery":
      return { ...item, ...locked, onSelect: noop };
    case "combo":
      return lockedCombo(item.id, item.labelKey, item.width, item.value, item.options);
    case "custom":
      // A custom item is a combo the selection already disabled (its own reason is baked into
      // `render`): with no slide selection in master view it shows no value, so rebuild it with ours.
      return lockedCombo(item.id, item.labelKey, item.width === undefined ? undefined : item.width - 2, null, []);
  }
}

/** The shared combo has no tooltip: a locked one is a custom item that carries the reason. */
function lockedCombo(id: string, labelKey: string, width: number | undefined, value: string | null, options: readonly RibbonOption[]): RibbonItem {
  return {
    kind: "custom",
    id,
    labelKey,
    size: "icon",
    disabled: true,
    tooltipKey: PPTX_MASTER_VIEW_REASON,
    width: Math.max(56, width ?? 140) + 2,
    render: () => createElement(PptxDisabledCombo, { labelKey, reasonKey: PPTX_MASTER_VIEW_REASON, width, value, options }),
  };
}

/** Pure: the tabs with everything outside the live groups locked. */
export function gatePptxRibbonForMasterView(tabs: readonly RibbonTab[]): RibbonTab[] {
  return tabs.map((tab) => ({
    ...tab,
    groups: tab.groups.map((group) =>
      MASTER_VIEW_LIVE_GROUPS.has(group.id)
        ? group
        : { ...group, ...(group.launcher ? { launcher: { ...group.launcher, onOpen: noop } } : {}), items: group.items.map(lockItem) },
    ),
  }));
}
