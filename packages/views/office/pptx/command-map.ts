import type { OfficeCapabilityStatus, OfficeHost } from "@uniwork/core/office";

/** The Q1-B capability rows that have a visible PPTX command. */
export type PptxCommandId =
  | "open"
  | "edit-text"
  | "edit-shape-image"
  | "save"
  | "export-pdf"
  | "speaker-notes"
  | "masters-layouts"
  | "animations"
  | "charts"
  | "tables"
  | "embedded-fonts"
  | "render-fidelity"
  | "find"
  | "undo"
  | "redo"
  | "presenter"
  | "fullscreen";

export interface PptxCommandCapability {
  status: OfficeCapabilityStatus;
  reason?: string;
}

export interface PptxCommand {
  id: PptxCommandId;
  /** i18next key under office.pptx.commands. */
  labelKey: string;
  /** Why a disabled command is unavailable. This is deliberately typed and
   * does not infer support from a visual affordance. */
  capability: PptxCommandCapability;
  /** Shape movement/resizing must use the host transform channel. */
  gesture?: boolean;
  mandatoryRow?: string;
  /** A real toggle command (aria-pressed), not a momentary action. */
  toggle?: boolean;
}

export interface PptxCommandMapOptions {
  host?: OfficeHost | null;
  capabilities?: Partial<Record<PptxCommandId, PptxCommandCapability | OfficeCapabilityStatus>>;
  includeSave?: boolean;
  includePresentation?: boolean;
}

const ROWS: Array<Pick<PptxCommand, "id" | "labelKey" | "mandatoryRow" | "gesture" | "toggle">> = [
  { id: "open", labelKey: "commands.open", mandatoryRow: "pptx-open" },
  { id: "edit-text", labelKey: "commands.edit_text", mandatoryRow: "pptx-edit-text" },
  { id: "edit-shape-image", labelKey: "commands.edit_shape_image", mandatoryRow: "pptx-edit-shape-image", gesture: true },
  { id: "save", labelKey: "commands.save", mandatoryRow: "pptx-save" },
  { id: "export-pdf", labelKey: "commands.export_pdf", mandatoryRow: "pptx-export-pdf" },
  { id: "speaker-notes", labelKey: "commands.speaker_notes", mandatoryRow: "pptx-notes" },
  { id: "masters-layouts", labelKey: "commands.masters_layouts", mandatoryRow: "pptx-masters-layouts" },
  { id: "animations", labelKey: "commands.animations", mandatoryRow: "pptx-animations" },
  { id: "charts", labelKey: "commands.charts", mandatoryRow: "pptx-charts" },
  { id: "tables", labelKey: "commands.tables", mandatoryRow: "pptx-tables" },
  { id: "embedded-fonts", labelKey: "commands.embedded_fonts", mandatoryRow: "pptx-embedded-fonts" },
  { id: "render-fidelity", labelKey: "commands.render_fidelity", mandatoryRow: "pptx-render-fidelity" },
  { id: "find", labelKey: "commands.find" },
  { id: "undo", labelKey: "commands.undo" },
  { id: "redo", labelKey: "commands.redo" },
  { id: "presenter", labelKey: "commands.presenter", toggle: true },
  { id: "fullscreen", labelKey: "commands.fullscreen" },
];

function asCapability(value: PptxCommandCapability | OfficeCapabilityStatus | undefined, fallback: PptxCommandCapability): PptxCommandCapability {
  if (!value) return fallback;
  return typeof value === "string" ? { status: value } : value;
}

function hasTransformChannel(host: OfficeHost | null | undefined): boolean {
  // The host contract is intentionally narrow. A host that has no IPC call
  // cannot claim a gesture even if the command is rendered in a toolbar.
  return typeof host?.ipc?.call === "function";
}

/** Build one honest command map. UI support is independent from the engine
 * capability probe; callers can replace any default with a typed entry. */
export function createPptxCommandMap(options: PptxCommandMapOptions = {}): PptxCommand[] {
  const transform = options.capabilities?.["edit-shape-image"];
  const defaults: Record<PptxCommandId, PptxCommandCapability> = {
    open: { status: "available" },
    "edit-text": { status: "available" },
    "edit-shape-image": transform
      ? asCapability(transform, { status: "unavailable" })
      : hasTransformChannel(options.host)
        ? { status: "available" }
        : { status: "unavailable", reason: "host:slides-edit-transform is not bound" },
    save: { status: "available" },
    "export-pdf": { status: "unavailable", reason: "PPTX PDF export is not bound in the browser build" },
    "speaker-notes": { status: "unavailable", reason: "Speaker notes are pending the PPTX acceptance cycle" },
    "masters-layouts": { status: "unavailable", reason: "Masters and layouts are pending the PPTX acceptance cycle" },
    animations: { status: "unavailable", reason: "Animations and transitions are pending the PPTX acceptance cycle" },
    charts: { status: "unavailable", reason: "Charts are pending the PPTX acceptance cycle" },
    tables: { status: "unavailable", reason: "Tables are pending the PPTX acceptance cycle" },
    "embedded-fonts": { status: "unavailable", reason: "Embedded fonts are pending the PPTX acceptance cycle" },
    "render-fidelity": { status: "unknown", reason: "Render fidelity is measured in 06b against the genoffice oracle" },
    find: { status: "available" },
    undo: { status: "available" },
    redo: { status: "available" },
    presenter: { status: "available" },
    fullscreen: { status: "available" },
  };
  const commands = ROWS
    .filter(({ id }) => (id === "save" ? options.includeSave !== false : true))
    .filter(({ id }) => (id === "presenter" || id === "fullscreen" ? options.includePresentation !== false : true))
    .map((row) => ({ ...row, capability: asCapability(options.capabilities?.[row.id], defaults[row.id]) }));
  return commands;
}

export function findPptxCommand(commands: readonly PptxCommand[], id: PptxCommandId): PptxCommand | undefined {
  return commands.find((command) => command.id === id);
}