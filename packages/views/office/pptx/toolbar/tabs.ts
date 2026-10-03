/**
 * The PPTX ribbon shell: the tab strip and the command groups each tab holds.
 *
 * The tab/group layout is data, not JSX, so the overflow budget, the roving
 * keyboard order and the "is this tab honest about being empty" question are
 * all pure functions a unit test can pin. Commands come from the EXISTING
 * `createPptxCommandMap` capabilities: this module only decides where a
 * command sits, never whether it is enabled (that stays the command map's job,
 * so a pending wave-B/C feature stays visibly disabled instead of faked).
 */
import type { PptxCommandId } from "../command-map";

export type PptxTabId =
  | "home"
  | "insert"
  | "design"
  | "transitions"
  | "animations"
  | "slide-show"
  | "review"
  | "view";

export type PptxGroupId =
  | "file"
  | "history"
  | "editing"
  | "insert"
  | "design"
  | "transitions"
  | "animations"
  | "show"
  | "review"
  | "view";

export interface PptxToolbarGroup {
  id: PptxGroupId;
  /** i18next key under office.pptx. */
  labelKey: string;
  commands: readonly PptxCommandId[];
}

export interface PptxToolbarTab {
  id: PptxTabId;
  /** i18next key under office.pptx. */
  labelKey: string;
  groups: readonly PptxToolbarGroup[];
}

/**
 * Ribbon order. Every command the command map can produce appears exactly once
 * across these tabs; a tab whose wave-B/C family has not landed yet holds no
 * group and renders the honest empty note instead of a fake control.
 */
export const PPTX_TOOLBAR_TABS: readonly PptxToolbarTab[] = [
  {
    id: "home",
    labelKey: "tabs.home",
    groups: [
      { id: "file", labelKey: "groups.file", commands: ["open", "save", "export-pdf"] },
      { id: "history", labelKey: "groups.history", commands: ["undo", "redo"] },
      { id: "editing", labelKey: "groups.editing", commands: ["edit-text", "edit-shape-image"] },
    ],
  },
  {
    id: "insert",
    labelKey: "tabs.insert",
    groups: [{ id: "insert", labelKey: "groups.insert", commands: ["charts", "tables"] }],
  },
  {
    id: "design",
    labelKey: "tabs.design",
    groups: [{ id: "design", labelKey: "groups.design", commands: ["masters-layouts", "embedded-fonts"] }],
  },
  // Transitions owns no command yet: `setTransition`/`setAdvanceTime` land with
  // wave B4, so the tab is present and reachable but honestly empty.
  { id: "transitions", labelKey: "tabs.transitions", groups: [] },
  {
    id: "animations",
    labelKey: "tabs.animations",
    groups: [{ id: "animations", labelKey: "groups.animations", commands: ["animations"] }],
  },
  {
    id: "slide-show",
    labelKey: "tabs.slide_show",
    groups: [{ id: "show", labelKey: "groups.show", commands: ["presenter", "fullscreen"] }],
  },
  {
    id: "review",
    labelKey: "tabs.review",
    groups: [{ id: "review", labelKey: "groups.review", commands: ["speaker-notes"] }],
  },
  {
    id: "view",
    labelKey: "tabs.view",
    groups: [{ id: "view", labelKey: "groups.view", commands: ["render-fidelity"] }],
  },
];

/** Every command id the shell places, in ribbon order. */
export function toolbarCommandIds(tabs: readonly PptxToolbarTab[] = PPTX_TOOLBAR_TABS): PptxCommandId[] {
  return tabs.flatMap((tab) => tab.groups.flatMap((group) => [...group.commands]));
}

/** A tab is empty when none of its groups names a command. */
export function tabIsEmpty(tab: PptxToolbarTab): boolean {
  return tab.groups.every((group) => group.commands.length === 0);
}

/**
 * Roving tab-index target for the tab strip (WAI-ARIA tabs pattern: arrows move
 * with wrap-around, Home/End jump to the ends). Returns null for a key the
 * strip does not own so the caller leaves the event alone.
 */
export function nextTabIndex(index: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return index >= last ? 0 : index + 1;
    case "ArrowLeft":
    case "ArrowUp":
      return index <= 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

export interface PptxToolbarOverflow {
  /** How many leading items stay inline. */
  visible: number;
  /** How many trailing items move into the overflow menu. */
  overflow: number;
}

/**
 * Fit a row of measured items into `availablePx`, reserving the overflow
 * button's own width. An unmeasured container (0/NaN, e.g. a layout-less DOM)
 * shows everything rather than hiding controls it cannot see the size of.
 */
export function computeToolbarOverflow(
  widthsPx: readonly number[],
  availablePx: number,
  moreWidthPx: number,
): PptxToolbarOverflow {
  const count = widthsPx.length;
  if (count === 0) return { visible: 0, overflow: 0 };
  if (!Number.isFinite(availablePx) || availablePx <= 0) return { visible: count, overflow: 0 };
  const total = widthsPx.reduce((sum, width) => sum + width, 0);
  if (total <= availablePx) return { visible: count, overflow: 0 };
  let used = moreWidthPx;
  let visible = 0;
  for (const width of widthsPx) {
    if (used + width > availablePx) break;
    used += width;
    visible += 1;
  }
  // Never collapse the whole row: one item stays reachable inline.
  if (visible === 0) visible = 1;
  return { visible, overflow: count - visible };
}

/** Index of the first enabled control, or 0 when none is enabled. */
export function firstRovingIndex(enabled: readonly boolean[]): number {
  const hit = enabled.findIndex(Boolean);
  return hit < 0 ? 0 : hit;
}

/**
 * Roving focus that skips disabled controls: a disabled button cannot take
 * focus, so moving onto one would silently stall the keyboard user. Clamps at
 * the ends (a group never wraps) and returns null for a key the group does not
 * own.
 */
export function nextRovingEnabledIndex(index: number, enabled: readonly boolean[], key: string): number | null {
  if (enabled.length === 0) return null;
  const last = enabled.length - 1;
  if (key === "Home") return firstRovingIndex(enabled);
  if (key === "End") {
    for (let i = last; i >= 0; i -= 1) if (enabled[i]) return i;
    return null;
  }
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : null;
  if (step === null) return null;
  let cursor = index;
  for (;;) {
    cursor += step;
    if (cursor < 0 || cursor > last) return index;
    if (enabled[cursor]) return cursor;
  }
}
