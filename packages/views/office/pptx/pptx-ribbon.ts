/**
 * The PPTX ribbon data model (UNI-927 chrome amendment R, CHROME-R).
 *
 * Pure data: no JSX and no React import. It maps the lane's tab/group/command
 * layout onto the SHARED `RibbonTab` model in `packages/views/office/ribbon`.
 * It only decides where a command sits, never whether it is enabled: the
 * enabled/disabled state and its reason come straight from the EXISTING
 * `createPptxCommandMap` capability, so a state-dependent refusal stays
 * visibly disabled with the same reason instead of being faked. A command whose
 * capability is `hidden` (no channel bound on this host, or not built yet) is
 * left out of the ribbon altogether.
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
  ChartColumn,
  CaseSensitive,
  FileDown,
  FolderOpen,
  Film,
  Image,
  Link,
  MessageSquare,
  Palette,
  Paintbrush,
  PanelTop,
  Replace,
  LayoutGrid,
  ArrowRightLeft,
  LayoutTemplate,
  PanelsTopLeft,
  Maximize,
  Monitor,
  Presentation,
  Printer,
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
import type { PptxPanelKind } from "./pptx-panel-host";
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
  | "view"
  | "slides"
  | "font"
  | "paragraph"
  | "drawing"
  | "tables"
  | "images"
  | "charts"
  | "links"
  | "text"
  | "media"
  | "themes"
  | "customize"
  | "transitions"
  | "comments"
  | "notes"
  | "views"
  | "arrange"
  | "master";

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
  print: Printer,
  "speaker-notes": StickyNote,
  "masters-layouts": LayoutTemplate,
  animations: Sparkles,
  charts: ChartColumn,
  tables: Table,
  "embedded-fonts": CaseSensitive,
  "render-fidelity": Monitor,
  find: Search,
  undo: Undo2,
  redo: Redo2,
  presenter: Presentation,
  fullscreen: Maximize,
  slideMaster: PanelsTopLeft,
};

/** Default icon per panel kind; a spec may override it. */
const PPTX_PANEL_ICONS: Partial<Record<PptxPanelKind, RibbonIcon>> = {
  sorter: LayoutGrid,
  format: Paintbrush,
  "text-format": Type,
  insert: Image,
  links: Link,
  headerfooter: PanelTop,
  media: Film,
  design: Palette,
  transitions: ArrowRightLeft,
  comments: MessageSquare,
  notes: StickyNote,
  animations: Sparkles,
  tables: Table,
  charts: ChartColumn,
};

/** A side panel opened from a ribbon item (a toggle that shows the panel). */
export interface PptxRibbonPanelSpec {
  kind: PptxPanelKind;
  /** FULL i18next key. */
  labelKey: string;
  /** FULL i18next key; defaults to the label. */
  tooltipKey?: string;
  icon?: RibbonIcon;
}

export interface PptxRibbonGroupSpec {
  id: PptxGroupId | string;
  /** FULL i18next key. */
  labelKey: string;
  commands?: readonly PptxCommandId[];
  panels?: readonly PptxRibbonPanelSpec[];
  /** Items the editor injects for this group id via options.groupItems[id], appended after commands+panels. */
  injected?: boolean;
  /** Injected items lead the group (the primary, large item); spec items follow as small. */
  injectedFirst?: boolean;
  /** Default true: the first item renders large. false = all small (Font/Paragraph groups, F4). */
  largeFirst?: boolean;
  /** Item order inside the group. Default commands-first. */
  order?: "commands-first" | "panels-first";
  /** Dialog launcher that opens a panel. */
  launcher?: { panel: PptxPanelKind; labelKey: string };
}

export interface PptxRibbonTabSpec {
  id: PptxTabId | string;
  /** FULL i18next key. */
  labelKey: string;
  groups: readonly PptxRibbonGroupSpec[];
}

const g = (id: string) => `office.pptx.groups.${id}`;
const p = (key: string) => `office.pptx.panels.${key}`;

/** UNI-958: New slide ADDS a slide (the editor injects it, bound to the edit port);
 *  the sorter stays on View and the status bar. */
const slides: PptxRibbonGroupSpec = { id: "slides", labelKey: g("slides"), injected: true };

/**
 * Fixed ribbon order. Every command the command map can produce appears exactly
 * once across the tab row plus these tabs. Undo/redo, the presenter toggle and
 * Find live in the tab row, so no tab repeats them. Side panels open from the
 * panel items here (UNI-927 F-02/F-10).
 */
export const PPTX_RIBBON_TABS: readonly PptxRibbonTabSpec[] = [
  {
    id: "home",
    labelKey: "office.pptx.tabs.home",
    groups: [
      slides,
      { id: "font", labelKey: g("font"), injected: true, largeFirst: false, launcher: { panel: "text-format", labelKey: p("font_dialog") } },
      { id: "paragraph", labelKey: g("paragraph"), injected: true, largeFirst: false, launcher: { panel: "text-format", labelKey: p("paragraph_dialog") } },
      { id: "drawing", labelKey: g("drawing"), panels: [{ kind: "format", labelKey: p("format") }], launcher: { panel: "format", labelKey: p("format") } },
      { id: "editing", labelKey: g("editing"), commands: ["edit-text", "edit-shape-image"] },
      { id: "file", labelKey: g("file"), commands: ["open", "save", "export-pdf", "print"] },
    ],
  },
  {
    id: "insert",
    labelKey: "office.pptx.tabs.insert",
    groups: [
      slides,
      { id: "tables", labelKey: g("tables"), commands: ["tables"] },
      {
        id: "images",
        labelKey: g("images"),
        panels: [{ kind: "insert", labelKey: p("shapes"), tooltipKey: p("shapes_hint"), icon: Shapes }],
        commands: ["charts"],
        order: "panels-first",
      },
      {
        id: "text",
        labelKey: g("text"),
        panels: [
          { kind: "headerfooter", labelKey: p("header_footer") },
          { kind: "links", labelKey: p("link") },
        ],
      },
      { id: "media", labelKey: g("media"), panels: [{ kind: "media", labelKey: p("media") }] },
    ],
  },
  {
    id: "design",
    labelKey: "office.pptx.tabs.design",
    groups: [
      { id: "themes", labelKey: g("themes"), panels: [{ kind: "design", labelKey: p("themes") }] },
      { id: "customize", labelKey: g("customize"), commands: ["masters-layouts", "embedded-fonts"] },
    ],
  },
  {
    id: "transitions",
    labelKey: "office.pptx.tabs.transitions",
    groups: [{ id: "transitions", labelKey: g("transitions"), panels: [{ kind: "transitions", labelKey: p("transitions") }] }],
  },
  { id: "animations", labelKey: "office.pptx.tabs.animations", groups: [{ id: "animations", labelKey: g("animations"), commands: ["animations"] }] },
  { id: "slide-show", labelKey: "office.pptx.tabs.slide_show", groups: [{ id: "show", labelKey: g("show"), commands: ["fullscreen"], injected: true, injectedFirst: true }] },
  {
    id: "review",
    labelKey: "office.pptx.tabs.review",
    groups: [
      { id: "comments", labelKey: g("comments"), panels: [{ kind: "comments", labelKey: p("comments") }] },
      { id: "notes", labelKey: g("notes"), commands: ["speaker-notes"] },
    ],
  },
  {
    id: "view",
    labelKey: "office.pptx.tabs.view",
    groups: [
      { id: "views", labelKey: g("views"), panels: [{ kind: "sorter", labelKey: p("sorter") }], commands: ["render-fidelity"], order: "panels-first" },
      // B6: the slide master view replaces the canvas while the toggle is pressed.
      { id: "master", labelKey: g("master"), commands: ["slideMaster"] },
    ],
  },
];

export interface PptxRibbonContextualTabSpec {
  id: string;
  labelKey: string;
  /** Which selection flag in `PptxRibbonContextualSelection` gates the tab. */
  when: keyof PptxRibbonContextualSelection;
  accent: RibbonAccent;
  groups: readonly PptxRibbonGroupSpec[];
}

const arrange: PptxRibbonGroupSpec = { id: "arrange", labelKey: g("arrange"), injected: true };
const linksGroup: PptxRibbonGroupSpec = { id: "links", labelKey: g("links"), panels: [{ kind: "links", labelKey: p("link") }] };

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
    groups: [
      {
        id: "picture",
        labelKey: g("picture"),
        panels: [
          { kind: "format", labelKey: p("format") },
          { kind: "insert", labelKey: p("change_picture"), icon: Replace },
        ],
      },
      linksGroup,
      arrange,
    ],
  },
  {
    id: "context-shape",
    labelKey: "office.pptx.context.shape",
    when: "shape",
    accent: "info",
    groups: [
      { id: "shape_styles", labelKey: g("shape_styles"), panels: [{ kind: "format", labelKey: p("format") }] },
      { id: "text", labelKey: g("text"), panels: [{ kind: "text-format", labelKey: p("text_format") }] },
      linksGroup,
      arrange,
    ],
  },
  {
    id: "context-table",
    labelKey: "office.pptx.context.table",
    when: "table",
    accent: "info",
    groups: [{ id: "table", labelKey: g("table"), commands: ["tables"] }, arrange],
  },
  {
    id: "context-chart",
    labelKey: "office.pptx.context.chart",
    when: "chart",
    accent: "info",
    groups: [{ id: "chart", labelKey: g("chart"), commands: ["charts"] }, arrange],
  },
];

export interface PptxRibbonContextualSelection {
  picture?: boolean;
  shape?: boolean;
  table?: boolean;
  chart?: boolean;
}

export interface PptxRibbonOptions {
  /** Which contextual tabs are live; omitted/false tabs do not render. */
  contextual?: PptxRibbonContextualSelection;
  /** Command dispatcher; absent leaves the mapped items inert (data only). */
  onCommand?: (id: PptxCommandId) => void;
  /** Toggle commands that should render pressed. */
  pressedCommands?: readonly PptxCommandId[];
  /** Panel toggle items render pressed when equal. */
  activePanel?: PptxPanelKind | null;
  /** Panel items and launchers call it (never when disabled). */
  onOpenPanel?: (kind: PptxPanelKind) => void;
  /** kind -> FULL i18n reason key; the item is disabled with tooltipKey = reason. */
  panelDisabled?: Partial<Record<PptxPanelKind, string>>;
  /** Injected items by group id. */
  groupItems?: Readonly<Record<string, readonly RibbonItem[]>>;
}

/** Group 0 collapses last (10), group 1 next (5), the rest first (0). */
export function pptxGroupPriority(index: number): number {
  return index === 0 ? 10 : index === 1 ? 5 : 0;
}

function mapItem(command: PptxCommand, size: "large" | "small", options: PptxRibbonOptions): RibbonItem {
  const disabled = command.capability.status !== "available";
  const pressed = options.pressedCommands?.includes(command.id) === true;
  const base = {
    id: command.id,
    labelKey: `office.pptx.${command.labelKey}`,
    icon: PPTX_COMMAND_ICONS[command.id],
    size,
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

function openPanel(kind: PptxPanelKind, options: PptxRibbonOptions): void {
  if (options.panelDisabled?.[kind]) return;
  options.onOpenPanel?.(kind);
}

function mapPanel(
  spec: PptxRibbonPanelSpec,
  groupId: string,
  size: "large" | "small",
  options: PptxRibbonOptions,
  usedIds: Set<string>,
): RibbonItem {
  const reason = options.panelDisabled?.[spec.kind];
  const plain = `panel-${spec.kind}`;
  const id = usedIds.has(plain) ? `panel-${groupId}-${spec.kind}` : plain;
  usedIds.add(id);
  const tooltipKey = reason ?? spec.tooltipKey;
  return {
    id,
    kind: "toggle",
    labelKey: spec.labelKey,
    icon: spec.icon ?? PPTX_PANEL_ICONS[spec.kind],
    size,
    disabled: Boolean(reason),
    ...(tooltipKey ? { tooltipKey } : {}),
    pressed: options.activePanel === spec.kind,
    onExecute: () => openPanel(spec.kind, options),
  };
}

type GroupEntry = { command: PptxCommand } | { panel: PptxRibbonPanelSpec };

function mapGroup(
  spec: PptxRibbonGroupSpec,
  commands: readonly PptxCommand[],
  options: PptxRibbonOptions,
  usedIds: Set<string>,
): RibbonGroup {
  const largeFirst = spec.largeFirst !== false;
  const injected = spec.injected ? (options.groupItems?.[spec.id] ?? []) : [];
  const lead = spec.injectedFirst ? injected : [];
  const sizeAt = (position: number) => (largeFirst && lead.length + position === 0 ? ("large" as const) : ("small" as const));
  const commandEntries: GroupEntry[] = (spec.commands ?? [])
    .map((id) => commands.find((command) => command.id === id))
    // A command the host can never run is dropped, not shown dead (R2-6).
    .filter((command): command is PptxCommand => Boolean(command) && command?.capability.hidden !== true)
    .map((command) => ({ command }));
  const panelEntries: GroupEntry[] = (spec.panels ?? []).map((panel) => ({ panel }));
  const ordered = spec.order === "panels-first" ? [...panelEntries, ...commandEntries] : [...commandEntries, ...panelEntries];
  const items: RibbonItem[] = ordered.map((entry, position) =>
    "command" in entry
      ? mapItem(entry.command, sizeAt(position), options)
      : mapPanel(entry.panel, spec.id, sizeAt(position), options, usedIds),
  );
  if (spec.injectedFirst) items.unshift(...lead);
  else items.push(...injected);
  const launcher = spec.launcher;
  return {
    id: spec.id,
    labelKey: spec.labelKey,
    priority: 0,
    ...(launcher ? { launcher: { labelKey: launcher.labelKey, onOpen: () => openPanel(launcher.panel, options) } } : {}),
    items,
  };
}

function mapGroups(specs: readonly PptxRibbonGroupSpec[], commands: readonly PptxCommand[], options: PptxRibbonOptions): RibbonGroup[] {
  const usedIds = new Set<string>();
  // Empty groups are dropped; priority is positional among the rendered ones.
  return specs
    .map((spec) => mapGroup(spec, commands, options, usedIds))
    .filter((group) => group.items.length > 0)
    .map((group, index) => ({ ...group, priority: pptxGroupPriority(index) }));
}

/**
 * Map the PPTX command capabilities onto the shared ribbon tabs. Fixed tabs
 * first (in the existing order), then the contextual tabs gated by
 * `options.contextual`. Groups with no resulting item are dropped.
 */
export function pptxRibbonTabs(commands: readonly PptxCommand[], options: PptxRibbonOptions = {}): RibbonTab[] {
  const fixed: RibbonTab[] = PPTX_RIBBON_TABS.map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    groups: mapGroups(tab.groups, commands, options),
  }));
  const contextual: RibbonTab[] = PPTX_RIBBON_CONTEXTUAL_TABS.map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    contextual: { when: options.contextual?.[tab.when] === true, accent: tab.accent },
    groups: mapGroups(tab.groups, commands, options),
  }));
  return [...fixed, ...contextual];
}

/** Every command id the FIXED tabs place, in render order (tab-row, panel and injected items excluded). */
export function pptxRibbonCommandIds(tabs: readonly RibbonTab[]): PptxCommandId[] {
  const placed = new Set<string>(PPTX_RIBBON_TABS.flatMap((tab) => tab.groups.flatMap((group) => group.commands ?? [])));
  return tabs
    .filter((tab) => !tab.contextual)
    .flatMap((tab) => tab.groups.flatMap((group) => group.items.filter((item) => placed.has(item.id)).map((item) => item.id as PptxCommandId)));
}
