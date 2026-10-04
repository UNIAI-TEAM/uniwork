/**
 * The PPTX ribbon shell: the tab strip and the command groups each tab holds.
 *
 * The tab/group layout is data, not JSX, so the overflow budget, the roving
 * keyboard order and the "is this tab honest about being empty" question are
 * all pure functions a unit test can pin. Commands come from the EXISTING
 * `createPptxCommandMap` capabilities: this module only decides where a
 * command sits, never whether it is enabled (that stays the command map's job,
 * so a pending wave-B/C feature stays visibly disabled instead of faked).
 *
 * C6 puts four controls in the TAB ROW rather than in a tab's group: the
 * quick-access undo/redo pair at the far left, Find at the far right and the
 * presenter view toggle. `PPTX_TAB_ROW_COMMANDS` names them so
 * `toolbarCommandIds` still lists every command exactly once.
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
  | "editing"
  | "insert"
  | "design"
  | "animations"
  | "show"
  | "review"
  | "view";

export interface PptxToolbarGroup {
  id: PptxGroupId;
  /** i18next key under office.pptx. */
  labelKey: string;
  commands: readonly PptxCommandId[];
  /** Stays first when the command row becomes one scrollable strip (C12, a
   *  phone-width viewport): the group the user reaches for most on that tab.
   *  Only a tab with more than one group needs it - a single-group tab is
   *  already first, so marking it `primary` documents nothing (F8). */
  primary?: boolean;
}

export interface PptxToolbarTab {
  id: PptxTabId;
  /** i18next key under office.pptx. */
  labelKey: string;
  groups: readonly PptxToolbarGroup[];
}

/** Quick-access undo/redo, pinned at the far left of the tab row (C6). */
export const PPTX_QUICK_ACCESS_COMMANDS: readonly PptxCommandId[] = ["undo", "redo"];
/** Present/slideshow as a view toggle at the right of the tab row (C6). */
export const PPTX_VIEW_TOGGLE_COMMAND: PptxCommandId = "presenter";
/** Find entry point at the far right of the tab row (C6). */
export const PPTX_FIND_COMMAND: PptxCommandId = "find";
/** Every control the tab row owns, in render order. */
export const PPTX_TAB_ROW_COMMANDS: readonly PptxCommandId[] = [
  ...PPTX_QUICK_ACCESS_COMMANDS,
  PPTX_VIEW_TOGGLE_COMMAND,
  PPTX_FIND_COMMAND,
];

/**
 * Ribbon order. Every command the command map can produce appears exactly once
 * across the tab row plus these tabs; a tab whose wave-B/C family has not
 * landed yet holds no group and renders the honest empty note instead of a
 * fake control. Undo/redo and the presenter toggle live in the tab row, so no
 * tab repeats them.
 */
export const PPTX_TOOLBAR_TABS: readonly PptxToolbarTab[] = [
  {
    id: "home",
    labelKey: "tabs.home",
    groups: [
      { id: "file", labelKey: "groups.file", commands: ["open", "save", "export-pdf"] },
      // Editing is the group a presenter reaches for first on Home, so it leads
      // the single scrollable row at phone widths.
      { id: "editing", labelKey: "groups.editing", commands: ["edit-text", "edit-shape-image"], primary: true },
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
    groups: [{ id: "show", labelKey: "groups.show", commands: ["fullscreen"] }],
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

/** Every command id the shell places (tab row + tabs), in render order. */
export function toolbarCommandIds(tabs: readonly PptxToolbarTab[] = PPTX_TOOLBAR_TABS): PptxCommandId[] {
  return [...PPTX_TAB_ROW_COMMANDS, ...tabs.flatMap((tab) => tab.groups.flatMap((group) => [...group.commands]))];
}

/**
 * Order for the single scrollable command strip (C12, phone widths): the
 * tab's `primary` groups first, everything else after, each keeping its
 * relative order so the fixed per-tab order still holds.
 */
export function orderGroupsForNarrow(groups: readonly PptxToolbarGroup[]): PptxToolbarGroup[] {
  return [...groups.filter((group) => group.primary), ...groups.filter((group) => !group.primary)];
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
