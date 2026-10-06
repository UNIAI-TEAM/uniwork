/**
 * Slide master / layout view model (B6ui, UNI-927) - pure types and helpers.
 *
 * The panel is presentational and command-emitting: the host feeds it the
 * deck's master/layout parts and the active part's elements, and it answers with
 * `MasterPanelEdit` values. The edit union below is structurally identical to
 * the engine half's master edit kinds, so the wire round maps it 1:1 (the
 * panel imports no engine value and no engine type).
 */

/** A master or layout part of the deck. */
export interface MasterPartView {
  partPath: string;
  kind: "master" | "layout";
  name: string;
}

/** A box in px, slide space. */
export interface MasterBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One element of the selected master/layout part. */
export interface MasterElementView {
  id: string;
  type: string;
  label: string;
  box: MasterBox;
  placeholder?: string;
  fill?: string | null;
  /** Current text of a text/placeholder element; seeds the inspector text field. */
  text?: string;
}

/** Every edit the panel can emit; field names match the engine union exactly. */
export type MasterPanelEdit =
  | { op: "master_edit_text"; part: string; elementId: string; text: string }
  | { op: "master_set_transform"; part: string; elementId: string; box: MasterBox }
  | { op: "master_set_fill"; part: string; elementId: string; color: string | null }
  | { op: "master_set_stroke"; part: string; elementId: string; color: string | null; widthPt?: number }
  | { op: "master_delete_element"; part: string; elementId: string };

export type MasterPanelStatus = "ready" | "loading" | "unbound";

export interface MasterPanelProps {
  parts: readonly MasterPartView[];
  activePart: string | null;
  onSelectPart: (partPath: string) => void;
  elements: readonly MasterElementView[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  /** Absent -> the panel is "unbound": every control disabled with a notice. */
  onEdit?: (edit: MasterPanelEdit) => void | Promise<unknown>;
  onClose?: () => void;
  status?: MasterPanelStatus;
  /** An edit is in flight: every control is disabled. */
  pending?: boolean;
  className?: string;
}

/** A master and the layouts that follow it. `master` is null for leading orphans. */
export interface MasterPartGroup {
  master: MasterPartView | null;
  layouts: MasterPartView[];
}

/**
 * Group parts master first, then its layouts. A layout belongs to the nearest
 * master before it in input order; layouts before any master share a group
 * with no master. Input order is otherwise kept (stable).
 */
export function groupMasterParts(parts: readonly MasterPartView[]): MasterPartGroup[] {
  const groups: MasterPartGroup[] = [];
  for (const part of parts) {
    if (part.kind === "master") {
      groups.push({ master: part, layouts: [] });
      continue;
    }
    let current = groups[groups.length - 1];
    if (!current) {
      current = { master: null, layouts: [] };
      groups.push(current);
    }
    current.layouts.push(part);
  }
  return groups;
}

/** Text fields apply to placeholder and text elements only. */
export function isTextElement(element: MasterElementView): boolean {
  return element.placeholder !== undefined || element.type === "text";
}

const HEX_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

/** "#RRGGBB" (or the 8-digit alpha form), upper-cased with "#"; null when not a colour. */
export function normalizeMasterColor(value: string): string | null {
  const trimmed = value.trim();
  if (!HEX_RE.test(trimmed)) return null;
  return ("#" + trimmed.replace(/^#/, "")).toUpperCase();
}

/** The `type="color"` input value: "#RRGGBB" or the fallback for a half-typed value. */
export function colorInputValue(value: string | null | undefined, fallback: string): string {
  const normalized = value ? normalizeMasterColor(value) : null;
  return normalized ? normalized.slice(0, 7) : fallback;
}

/** Text drafts of the four box fields. */
export interface MasterBoxDraft {
  x: string;
  y: string;
  w: string;
  h: string;
}

export function boxToDraft(box: MasterBox): MasterBoxDraft {
  const fmt = (n: number) => String(Number.isFinite(n) ? Number(n.toFixed(2)) : 0);
  return { x: fmt(box.x), y: fmt(box.y), w: fmt(box.w), h: fmt(box.h) };
}

export type MasterBoxResult = { ok: true; box: MasterBox } | { ok: false; field: keyof MasterBoxDraft };

const COORD_MAX = 1_000_000;

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Validate the box drafts: finite numbers, w and h at least 1 px. */
export function parseBoxDraft(draft: MasterBoxDraft): MasterBoxResult {
  const x = parseNumber(draft.x);
  if (x === null || Math.abs(x) > COORD_MAX) return { ok: false, field: "x" };
  const y = parseNumber(draft.y);
  if (y === null || Math.abs(y) > COORD_MAX) return { ok: false, field: "y" };
  const w = parseNumber(draft.w);
  if (w === null || w < 1 || w > COORD_MAX) return { ok: false, field: "w" };
  const h = parseNumber(draft.h);
  if (h === null || h < 1 || h > COORD_MAX) return { ok: false, field: "h" };
  return { ok: true, box: { x, y, w, h } };
}

export const MASTER_STROKE_WIDTH_MAX = 1584;

/** Outline width in pt: blank -> undefined (leave unchanged), else 0..1584; null = invalid. */
export function parseStrokeWidth(value: string): number | undefined | null {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = parseNumber(trimmed);
  if (n === null || n < 0 || n > MASTER_STROKE_WIDTH_MAX) return null;
  return n;
}

export function buildTextEdit(part: string, elementId: string, text: string): MasterPanelEdit {
  return { op: "master_edit_text", part, elementId, text };
}

export function buildTransformEdit(part: string, elementId: string, box: MasterBox): MasterPanelEdit {
  return { op: "master_set_transform", part, elementId, box };
}

export function buildFillEdit(part: string, elementId: string, color: string | null): MasterPanelEdit {
  return { op: "master_set_fill", part, elementId, color };
}

export function buildStrokeEdit(
  part: string,
  elementId: string,
  color: string | null,
  widthPt?: number,
): MasterPanelEdit {
  return widthPt === undefined
    ? { op: "master_set_stroke", part, elementId, color }
    : { op: "master_set_stroke", part, elementId, color, widthPt };
}

export function buildDeleteEdit(part: string, elementId: string): MasterPanelEdit {
  return { op: "master_delete_element", part, elementId };
}
