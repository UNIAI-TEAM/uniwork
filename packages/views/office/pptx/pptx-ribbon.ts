/**
 * The PPTX ribbon data model (UNI-927 chrome amendment R, CHROME-R).
 *
 * Pure data: no JSX and no React import. It maps the lane's tab/group/command
 * layout onto the SHARED `RibbonTab` model in `packages/views/office/ribbon`.
 * It only decides where a command sits, never whether it is enabled: the
 * enabled/disabled state and its reason come straight from the EXISTING
 * `createPptxCommandMap` capability, so a wave-B/C command stays visibly
 * disabled with the same reason instead of being faked.
 *
 * Keys are FULL i18next paths (`office.pptx.tabs.home`, not `tabs.home`):
 * the shared ribbon translates at the root (`useTranslation()`), so a relative
 * key would resolve against the wrong namespace and echo the key as its label.
 *
 * Group priority follows the shared ribbon's collapse rule (lowest collapses
 * first, ties from the right): a tab's FIRST group collapses LAST, so it gets
 * the highest priority. tabs.ts never carried a `collapseAt`; this is the
 * explicit mapping: group 0 -> 10, group 1 -> 5, group 2+ -> 0.
 */
import {
  BarChart3,
  CaseSensitive,
  FileDown,
  FolderOpen,
  LayoutTemplate,
  Maximize,
  Monitor,
  Presentation,
  Redo2,
  Save,
  Search,
  Shapes,
  Sparkles,
  StickyNote,
  Table,
  Type,
  Undo2,
} from "lucide-react";
import type { PptxCommand, PptxCommandId } from "./command-map";
import type { RibbonAccent, RibbonGroup, RibbonIcon, RibbonItem, RibbonTab } from "../ribbon";

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

/** Icons are visual only; a command with no icon still renders its label. */
const PPTX_COMMAND_ICONS: Partial<Record<PptxCommandId, RibbonIcon>> = {
  open: FolderOpen,
  "edit-text": Type,
  "edit-shape-image": Shapes,
  save: Save,
  "export-pdf": FileDown,
  "speaker-notes": StickyNote,
  "masters-layouts": LayoutTemplate,
  animations: Sparkles,
  charts: BarChart3,
  tables: Table,
  "embedded-fonts": CaseSensitive,
  "render-fidelity": Monitor,
  find: Search,
  undo: Undo2,
  redo: Redo2,
  presenter: Presentation,
  fullscreen: Maximize,
};

export interface PptxRibbonGroupSpec {
  id: PptxGroupId | string;
  /** FULL i18next key. */
  labelKey: string;
  commands: readonly PptxCommandId[];
}

export interface PptxRibbonTabSpec {
  id: PptxTabId | string;
  /** FULL i18next key. */
  labelKey: string;
  groups: readonly PptxRibbonGroupSpec[];
}

/**
 * Fixed ribbon order. Every command the command map can produce appears exactly
 * once across the tab row plus these tabs; Transitions owns no command yet, so
 * it is present and reachable but honestly empty. Undo/redo and the presenter
 * toggle live in the tab row, so no tab repeats them.
 */
export const PPTX_RIBBON_TABS: readonly PptxRibbonTabSpec[] = [
  {
    id: "home",
    labelKey: "office.pptx.tabs.home",
    groups: [
      { id: "file", labelKey: "office.pptx.groups.file", commands: ["open", "save", "export-pdf"] },
      { id: "editing", labelKey: "office.pptx.groups.editing", commands: ["edit-text", "edit-shape-image"] },
    ],
  },
  { id: "insert", labelKey: "office.pptx.tabs.insert", groups: [{ id: "insert", labelKey: "office.pptx.groups.insert", commands: ["charts", "tables"] }] },
  { id: "design", labelKey: "office.pptx.tabs.design", groups: [{ id: "design", labelKey: "office.pptx.groups.design", commands: ["masters-layouts", "embedded-fonts"] }] },
  { id: "transitions", labelKey: "office.pptx.tabs.transitions", groups: [] },
  { id: "animations", labelKey: "office.pptx.tabs.animations", groups: [{ id: "animations", labelKey: "office.pptx.groups.animations", commands: ["animations"] }] },
  { id: "slide-show", labelKey: "office.pptx.tabs.slide_show", groups: [{ id: "show", labelKey: "office.pptx.groups.show", commands: ["fullscreen"] }] },
  { id: "review", labelKey: "office.pptx.tabs.review", groups: [{ id: "review", labelKey: "office.pptx.groups.review", commands: ["speaker-notes"] }] },
  { id: "view", labelKey: "office.pptx.tabs.view", groups: [{ id: "view", labelKey: "office.pptx.groups.view", commands: ["render-fidelity"] }] },
];

export interface PptxRibbonContextualTabSpec {
  id: string;
  labelKey: string;
  /** Which selection flag in `PptxRibbonContextualSelection` gates the tab. */
  when: keyof PptxRibbonContextualSelection;
  accent: RibbonAccent;
  groups: readonly PptxRibbonGroupSpec[];
}

/**
 * R4 contextual tabs. They appear after the fixed tabs only while the caller
 * says the selection is inside that object; selecting the object never
 * force-switches the active tab (the ribbon keeps the current one).
 */
export const PPTX_RIBBON_CONTEXTUAL_TABS: readonly PptxRibbonContextualTabSpec[] = [
  {
    id: "context-picture",
    labelKey: "office.pptx.context.picture",
    when: "picture",
    accent: "info",
    groups: [{ id: "context-picture-format", labelKey: "office.pptx.context.picture", commands: ["edit-shape-image"] }],
  },
  {
    id: "context-shape",
    labelKey: "office.pptx.context.shape",
    when: "shape",
    accent: "info",
    groups: [{ id: "context-shape-format", labelKey: "office.pptx.context.shape", commands: ["edit-shape-image"] }],
  },
  {
    id: "context-table",
    labelKey: "office.pptx.context.table",
    when: "table",
    accent: "info",
    groups: [{ id: "context-table-design", labelKey: "office.pptx.context.table", commands: ["tables"] }],
  },
];

export interface PptxRibbonContextualSelection {
  picture?: boolean;
  shape?: boolean;
  table?: boolean;
}

export interface PptxRibbonOptions {
  /** Which contextual tabs are live; omitted/false tabs do not render. */
  contextual?: PptxRibbonContextualSelection;
  /** Command dispatcher; absent leaves the mapped items inert (data only). */
  onCommand?: (id: PptxCommandId) => void;
  /** Toggle commands that should render pressed. */
  pressedCommands?: readonly PptxCommandId[];
}

/** Group 0 collapses last (10), group 1 next (5), the rest first (0). */
export function pptxGroupPriority(index: number): number {
  return index === 0 ? 10 : index === 1 ? 5 : 0;
}

function mapItem(command: PptxCommand, primary: boolean, options: PptxRibbonOptions): RibbonItem {
  const disabled = command.capability.status !== "available";
  const pressed = options.pressedCommands?.includes(command.id) === true;
  const base = {
    id: command.id,
    labelKey: `office.pptx.${command.labelKey}`,
    icon: PPTX_COMMAND_ICONS[command.id],
    size: primary ? ("large" as const) : ("small" as const),
    disabled,
    ...(disabled && command.capability.reason ? { tooltipKey: command.capability.reason } : {}),
  };
  // The shared ribbon renders a disabled item as `aria-disabled` (so it stays
  // reachable by keyboard), which leaves it clickable; the lane keeps its own
  // contract that a disabled command never dispatches.
  const onExecute = () => {
    if (disabled) return;
    options.onCommand?.(command.id);
  };
  if (command.toggle === true) return { ...base, kind: "toggle", pressed, onExecute };
  return { ...base, kind: "button", onExecute };
}

function mapGroup(spec: PptxRibbonGroupSpec, index: number, commands: readonly PptxCommand[], options: PptxRibbonOptions): RibbonGroup {
  const items = spec.commands
    .map((id) => commands.find((command) => command.id === id))
    .filter((command): command is PptxCommand => Boolean(command))
    .map((command, commandIndex) => mapItem(command, commandIndex === 0, options));
  return { id: spec.id, labelKey: spec.labelKey, priority: pptxGroupPriority(index), items };
}

/**
 * Map the PPTX command capabilities onto the shared ribbon tabs. Fixed tabs
 * first (in the existing order), then the three contextual tabs gated by
 * `options.contextual`.
 */
export function pptxRibbonTabs(commands: readonly PptxCommand[], options: PptxRibbonOptions = {}): RibbonTab[] {
  const fixed: RibbonTab[] = PPTX_RIBBON_TABS.map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    groups: tab.groups.map((group, index) => mapGroup(group, index, commands, options)),
  }));
  const contextual: RibbonTab[] = PPTX_RIBBON_CONTEXTUAL_TABS.map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    contextual: { when: options.contextual?.[tab.when] === true, accent: tab.accent },
    groups: tab.groups.map((group, index) => mapGroup(group, index, commands, options)),
  }));
  return [...fixed, ...contextual];
}

/** Every command id the FIXED tabs place, in render order (tab-row excluded). */
export function pptxRibbonCommandIds(tabs: readonly RibbonTab[]): PptxCommandId[] {
  return tabs
    .filter((tab) => !tab.contextual)
    .flatMap((tab) => tab.groups.flatMap((group) => group.items.map((item) => item.id as PptxCommandId)));
}