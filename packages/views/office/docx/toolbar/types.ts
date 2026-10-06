import type { ComponentType } from "react";
import type { RibbonItem } from "../../ribbon";
import type { DocxCommandRuntime, DocxRuntimeFormatState } from "../commands";
import type { DocxDocumentScope } from "../editor-store";
import type { DocxEditorHandle, DocxSaveCoordinator, DocxSelection } from "../types";

export type DocxToolbarTabId = "home" | "insert" | "layout" | "review" | "view";

/**
 * Ownership model for wave A. The shell owns this context type and the tab
 * structure; every group component under toolbar/groups/ receives it as its
 * props and owns its own file. A group task adds commands and format-state
 * fields in its commands/<area>.ts factory — the intersection types in
 * commands/index.ts (and therefore this context) pick the additions up, so a
 * group never edits the shell or this file to reach them.
 */
export interface DocxToolbarGroupContext {
  /** The host handle: selection port, commands, renderSurface. */
  editor: DocxEditorHandle;
  coordinator: DocxSaveCoordinator;
  /** Composed format state; null until a document is open. */
  format: DocxRuntimeFormatState | null;
  /** Composed command runtime; undefined on a handle that only stubs the base contract. */
  commands?: DocxCommandRuntime;
  selection: DocxSelection | null;
  readOnly: boolean;
  saving: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave?: () => void;
  /** UNI-957: this document's scope (live editor, Find, zoom, ribbon dialogs)
   *  for plain-data builders that cannot call hooks. DocxEditor always sets it. */
  docScope?: DocxDocumentScope;
}

export interface DocxToolbarGroup {
  /** Stable id, rendered as `data-ribbon-group` (group chrome) / `data-ribbon-item` (item) for tests. */
  id: string;
  /** i18next key used as the group's accessible name. */
  labelKey: string;
  component: ComponentType<DocxToolbarGroupContext>;
  /**
   * Typed ribbon items for this group (R7). When present the ribbon renders
   * these items directly - large/small/icon buttons, toggles, splits, combos,
   * galleries - instead of the single custom item that wraps `component`.
   * When absent the shell keeps today's one-custom-item-per-group path, so a
   * group can migrate to the typed model without losing any command.
   */
  ribbonItems?: (context: DocxToolbarGroupContext) => readonly RibbonItem[];
  /** Container width (px) below which the group collapses into the overflow
   * menu; 0 (or absent) keeps the group inline at every width. */
  collapseAt?: number;
}

export interface DocxToolbarTab {
  id: DocxToolbarTabId;
  labelKey: string;
  groups: readonly DocxToolbarGroup[];
}

/** The shell's props are the shared context: the editor builds it once and
 * hands it to the toolbar and every chrome slot. */
export type DocxToolbarProps = DocxToolbarGroupContext;
