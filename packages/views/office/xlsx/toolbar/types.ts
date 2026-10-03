import type { ComponentType } from "react";
import type { XlsxEditorPermissions, XlsxSelection } from "../types";

/** The six toolbar tabs. The active tab is local UI state and is never
 *  persisted; each tab carries named command groups from the registry. */
export type XlsxToolbarTabId = "home" | "insert" | "formulas" | "data" | "review" | "view";

export interface XlsxToolbarTabDefinition {
  readonly id: XlsxToolbarTabId;
  /** i18n key under `office.xlsx.toolbar.tabs.*`. */
  readonly labelKey: string;
}

/** The slice of the toolbar props a command group may read. It is declared
 *  here, not in `xlsx-toolbar.tsx`, so a group file never imports the shell;
 *  the public `XlsxToolbarProps` extends it and adds the coordinator/save
 *  fields only the persistent right-side cluster needs. */
export interface XlsxToolbarGroupProps {
  readOnly?: boolean;
  permissions?: XlsxEditorPermissions;
  selection: XlsxSelection | null;
  canUndo: boolean;
  canRedo: boolean;
  canRecalculate: boolean;
  canFormat: boolean;
  recalculating: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onNumberFormat: () => void;
  onRecalculate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onShowSheets: () => void;
}

/** One entry of the extension seam. A Wave A task adds one group to one tab
 *  by appending one object (and one import of its own component) to
 *  `XLSX_TOOLBAR_GROUPS` in `registry.ts`. */
export interface XlsxToolbarGroupDefinition {
  readonly id: string;
  readonly tab: XlsxToolbarTabId;
  /** Ascending within the tab. Groups with the highest order collapse into
   *  the overflow panel first when the strip runs out of width. */
  readonly order: number;
  /** i18n key under `office.xlsx.toolbar.groups.*`; the visible, accessible
   *  name of the group. */
  readonly labelKey: string;
  readonly Component: ComponentType<XlsxToolbarGroupProps>;
  /** When it returns false the group is not rendered at all — no label and no
   *  controls. Use it when the host cannot offer the commands at all (the
   *  grid has no recalculate controller); read-only and selection states stay
   *  on the controls as `aria-disabled`. */
  readonly isAvailable?: (context: XlsxToolbarGroupProps) => boolean;
}
