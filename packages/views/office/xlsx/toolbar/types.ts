import type { ComponentType } from "react";
import type { XlsxGridFormatState, XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxEditorPermissions, XlsxSelection } from "../types";

/** The six toolbar tabs. The active tab is local UI state and is never
 *  persisted; each tab carries named command groups from the registry. */
export type XlsxToolbarTabId = "home" | "insert" | "formulas" | "data" | "review" | "view";

export interface XlsxToolbarTabDefinition {
  readonly id: XlsxToolbarTabId;
  /** i18n key under `office.xlsx.toolbar.tabs.*`. */
  readonly labelKey: string;
}

/** The narrow renderer-command port a group executes through. The mounted
 *  renderer refuses read-only/no-selection commands and the command policy
 *  stays authoritative, so a group never needs a save or byte path of its own;
 *  `false` means the renderer did not run the command. */
export interface XlsxToolbarCommands {
  execute(id: string, params?: unknown): boolean;
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
  /** Present when the host mounts the live grid; absent on the snapshot-table
   *  fallback, where every renderer command is unavailable. */
  commands?: XlsxToolbarCommands;
  /** The active selection's mirrored style; null until the renderer reports
   *  one (controls then render their inactive state). */
  formatState?: XlsxGridFormatState | null;
  onUndo: () => void;
  onRedo: () => void;
  onNumberFormat: () => void;
  onRecalculate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onShowSheets: () => void;
  /** Opens the editor-owned find & replace panel. Absent when the host has no
   *  mounted grid: the panel reads its cells from the renderer host. */
  onOpenFind?: () => void;
  /** Opens the editor-owned Advanced Filter dialog. Absent when the host has no
   *  mounted grid: its column provider reads the header row from the renderer
   *  host. */
  onOpenAdvancedFilter?: () => void;
  /** Opens the editor-owned Page Setup dialog. */
  onOpenPageSetup?: () => void;
  /** Prints the document through the host print path. */
  onPrint?: () => void;
  /** Downloads the active sheet as CSV. */
  onExportCsv?: () => void;
  /** The renderer host for the groups that must read cells (AutoSum's guess).
   *  Absent on the snapshot-table fallback. */
  host?: XlsxGridHostPort;
  /** The mounted workbook id (`file-<sha256>`); null without a live grid. */
  unitId?: string | null;
  /** The active sheet's live name; the groups' reads target it. */
  sheetName?: string | null;
  /** Live-name -> live-id resolver (a session rename keeps the id). */
  resolveSheetId?: (liveName: string) => string | undefined;
  /** Opens the editor-owned Function Library dialog. Absent without a grid. */
  onOpenFunctionLibrary?: () => void;
  /** Opens the editor-owned shortcuts map/help dialog. */
  onOpenShortcuts?: () => void;
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
