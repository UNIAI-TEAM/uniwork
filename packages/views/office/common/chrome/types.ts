import type { ReactNode } from "react";

/**
 * One tab in the chrome's tab row. The caller owns the tab list and, for each
 * tab, the command groups that tab shows - the chrome never invents a control.
 */
export interface EditorChromeTab {
  id: string;
  label: string;
  /** Command groups for this tab, most used first. */
  groups: readonly EditorChromeCommandGroup[];
}

/** One group of controls inside the single command row (brief C7). */
export interface EditorChromeCommandGroup {
  id: string;
  /** Shown as a heading when the group moves into the "»" menu. */
  label?: string;
  items: readonly EditorChromeCommandItem[];
}

/**
 * One control. `label` is the accessible name, the tooltip and the text of the
 * "»" menu entry, so a control keeps its name wherever the row puts it.
 * `render` carries a caller-supplied control (a select, a split button); the
 * row renders it as-is and the "»" menu falls back to `label` + `onSelect`.
 */
export interface EditorChromeCommandItem {
  id: string;
  label: string;
  icon?: ReactNode;
  render?: ReactNode;
  /** Renders `aria-pressed` on the button. */
  pressed?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

/** One entry of the tab row's view segmented control. */
export interface EditorChromeViewMode {
  id: string;
  label: string;
}

/** The status bar's two slots (brief C10). */
export interface EditorChromeStatusItems {
  left?: ReactNode;
  right?: ReactNode;
}

export interface EditorChromeProps {
  tabs?: readonly EditorChromeTab[];
  /** Defaults to the first tab. */
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  /** Quick-access history, far left of the tab row (C6). */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Find/replace affordance; the Ctrl+F binding stays with the consumer. */
  onFind?: () => void;
  findLabel?: string;
  tabsLabel?: string;
  viewLabel?: string;
  viewModes?: readonly EditorChromeViewMode[];
  activeViewMode?: string;
  onViewModeChange?: (id: string) => void;
  status?: EditorChromeStatusItems;
  statusLabel?: string;
  commandsLabel?: string;
  overflowLabel?: string;
  /** Width reserved for the trailing "»" control in the overflow decision. */
  overflowButtonWidth?: number;
  className?: string;
}
