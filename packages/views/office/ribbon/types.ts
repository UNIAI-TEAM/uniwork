import type { ComponentType, ReactNode } from "react";

/**
 * Data model of the shared Office ribbon (UNI-931, chrome amendment R).
 * Every editor describes its tabs with these types and renders <OfficeRibbon>;
 * the ribbon owns layout, adaptive collapse, collapse-to-tabs, the simplified
 * phone layout, aria and keyboard focus. Labels are i18next keys, never text.
 */

/** Visual size of an item. `large` = icon over a 1-2 line label at full body
 * height, `small` = icon + label stacked three per column, `icon` = icon only
 * with a tooltip, packed in rows. */
export type RibbonSize = "large" | "small" | "icon";

/** Any lucide icon (or a component with the same props). */
export type RibbonIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

/** Contextual tab accent: a measured token pair from packages/ui. */
export type RibbonAccent = "brand" | "info" | "success" | "warning";

export interface RibbonMenuEntry {
  id: string;
  labelKey: string;
  icon?: RibbonIcon;
  disabled?: boolean;
  /** Renders a checked mark (e.g. the current line spacing). */
  checked?: boolean;
  onSelect: () => void;
}

export interface RibbonOption {
  value: string;
  /** Literal text that is not translated (a font family, "11"). */
  label?: string;
  /** i18next key; wins over `label`. */
  labelKey?: string;
}

interface RibbonItemBase {
  /** Stable id, rendered as `data-ribbon-item`. */
  id: string;
  /** i18next key: visible label for large/small, accessible name always. */
  labelKey: string;
  icon?: RibbonIcon;
  /** Size at full width. Default `small`. */
  size?: RibbonSize;
  /** Smallest size adaptive collapse may shrink the item to before the whole
   * group folds into one button. Default `icon` when the item has an icon,
   * otherwise `small`. Set `large` to keep a primary command large. */
  collapseAs?: RibbonSize;
  disabled?: boolean;
  /** i18next key for the tooltip; defaults to the label. */
  tooltipKey?: string;
  /** Display string such as "Ctrl+B", appended to the tooltip. */
  shortcut?: string;
  /** Start a new row when the item is laid out in an icon strip. */
  rowBreak?: boolean;
}

export interface RibbonButtonItem extends RibbonItemBase {
  kind: "button";
  onExecute: () => void;
}

export interface RibbonToggleItem extends RibbonItemBase {
  kind: "toggle";
  pressed: boolean;
  onExecute: () => void;
}

/** Primary action + ▾ menu (Paste ▾, Bullets ▾). */
export interface RibbonSplitItem extends RibbonItemBase {
  kind: "split";
  pressed?: boolean;
  onExecute: () => void;
  menu: readonly RibbonMenuEntry[];
}

/** A button that only opens a menu (Line spacing ▾, Change case ▾). */
export interface RibbonDropdownItem extends RibbonItemBase {
  kind: "dropdown";
  menu: readonly RibbonMenuEntry[];
}

/** Inline select (font family, font size). Always rendered inline. */
export interface RibbonComboItem extends RibbonItemBase {
  kind: "combo";
  value: string | null;
  options: readonly RibbonOption[];
  onChange: (value: string) => void;
  /** Width in px. Default 140, never rendered below 56. */
  width?: number;
}

export interface RibbonGalleryOption {
  id: string;
  labelKey?: string;
  label?: string;
  /** Live preview inside the card; defaults to the label. */
  preview?: ReactNode;
}

/** Card gallery (Styles). Shrinks its visible card count before the group
 * collapses; every card stays reachable through the "More" menu. */
export interface RibbonGalleryItem extends RibbonItemBase {
  kind: "gallery";
  options: readonly RibbonGalleryOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Cards shown at full width. Default 4. */
  maxVisible?: number;
  /** Cards shown once the group shrinks. Default 1. */
  minVisible?: number;
  /** Specimen text on cards without a `preview`. Default "AaBbCcDd". */
  sample?: string;
  /** Card width in px. Default 76. */
  cardWidth?: number;
}

export interface RibbonRenderContext {
  /** Effective size after adaptive collapse. */
  size: RibbonSize;
  /** True inside a collapsed group's dropdown panel or the simplified panel. */
  inPanel: boolean;
}

/** Escape hatch for controls the ribbon does not model (an editable font size
 * field, a colour picker, a whole pre-ribbon group component). */
export interface RibbonCustomItem extends RibbonItemBase {
  kind: "custom";
  render: (context: RibbonRenderContext) => ReactNode;
  /** Estimated width in px at full size, used by adaptive collapse. Default 96. */
  width?: number;
}

export type RibbonItem =
  | RibbonButtonItem
  | RibbonToggleItem
  | RibbonSplitItem
  | RibbonDropdownItem
  | RibbonComboItem
  | RibbonGalleryItem
  | RibbonCustomItem;

export interface RibbonGroup {
  id: string;
  /** Caption shown under the group and used as its aria-label. */
  labelKey: string;
  /** Collapse order: the LOWEST priority collapses first; ties collapse from
   * the right. A lane's `collapseAt` maps to `priority = -collapseAt`. */
  priority: number;
  /** Icon of the single button the group becomes when fully collapsed;
   * defaults to the first item's icon. */
  icon?: RibbonIcon;
  /** Dialog launcher ↘ next to the caption (Font, Paragraph, Page setup). */
  launcher?: { labelKey: string; onOpen: () => void };
  items: readonly RibbonItem[];
}

export interface RibbonContextual {
  /** The tab shows only while this is true (selection inside the object). */
  when: boolean;
  accent?: RibbonAccent;
}

export interface RibbonTab {
  id: string;
  labelKey: string;
  /** Contextual tabs render after the fixed tabs, accent-coloured. */
  contextual?: RibbonContextual;
  groups: readonly RibbonGroup[];
}

/** Collapse stage of one group: 0 = declared sizes, 1 = large -> small,
 * 2 = small -> icon (gallery at its minimum), 3 = one button + panel. */
export type RibbonGroupStage = 0 | 1 | 2 | 3;
