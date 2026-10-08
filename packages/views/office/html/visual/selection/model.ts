/**
 * Pure model for the HTML visual-edit selection bridge (H5).
 *
 * The preview inspector (S1) reports a selection as a pair of frame messages:
 * `select` carries the element id, `rect` carries its geometry. Both cross a
 * sandbox boundary, so every field is untrusted, document-derived data: this
 * module validates and clamps each one and ignores anything malformed instead
 * of trusting it. Nothing here reads or writes the document and nothing calls
 * an H3 op - the bridge only reports where a selection is.
 *
 * `select` and `hover` are separate slots: hover is tracking feedback and must
 * never clobber the committed selection (H6-H8 act on `selected` only).
 */

/** Mirrors the inspector's own bounds (preview-inspector.ts): a frame cannot
 * make the parent store an unbounded id or rect. Module-private: nothing
 * outside this file decides what a valid bound is. */
const HTML_SELECTION_MAX_SID = 2 ** 31 - 1;
const HTML_SELECTION_MAX_RECT = 10_000_000;

/** A tag name is short and shaped like a tag name, or it is dropped. */
const MAX_NODE_NAME = 32;
const NODE_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/i;

export interface HtmlSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HtmlSelection {
  /** The inspector's element id (`data-sid`), always a positive safe integer. */
  sid: number;
  /** Frame-viewport geometry, or null until the matching `rect` arrives. */
  rect: HtmlSelectionRect | null;
  /** Optional tag name; null with today's inspector, which does not send one. */
  nodeName: string | null;
}

export interface HtmlSelectionState {
  /** The committed selection (`select`), or null. */
  selected: HtmlSelection | null;
  /** The hovered element (`hover`), or null. Never affects `selected`. */
  hovered: HtmlSelection | null;
}

/** The initial state. Shared, so it is never mutated: the reducer always
 * returns a new object and leaves this one untouched. */
export const HTML_SELECTION_EMPTY: HtmlSelectionState = { selected: null, hovered: null };

type SidField = { ok: true; sid: number | null } | { ok: false };

/** `null` is a valid "nothing selected"; anything else must be a positive
 * safe integer inside the inspector's own bound, or the event is ignored. */
function sidField(value: unknown): SidField {
  if (value === null) return { ok: true, sid: null };
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return { ok: false };
  if (value <= 0 || value > HTML_SELECTION_MAX_SID) return { ok: false };
  return { ok: true, sid: value };
}

function clampCoord(value: number): number {
  return Math.min(HTML_SELECTION_MAX_RECT, Math.max(-HTML_SELECTION_MAX_RECT, value));
}

function clampSize(value: number): number {
  return Math.min(HTML_SELECTION_MAX_RECT, Math.max(0, value));
}

/** A rect is only a rect when all four parts are finite numbers; it is then
 * clamped so the overlay can never be asked to paint outside the bound. */
function rectField(value: unknown): HtmlSelectionRect | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (typeof y !== "number" || !Number.isFinite(y)) return null;
  if (typeof width !== "number" || !Number.isFinite(width)) return null;
  if (typeof height !== "number" || !Number.isFinite(height)) return null;
  return { x: clampCoord(x), y: clampCoord(y), width: clampSize(width), height: clampSize(height) };
}

function nodeNameField(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NODE_NAME) return null;
  return NODE_NAME_RE.test(value) ? value.toLowerCase() : null;
}

function entry(sid: number, record: Record<string, unknown>): HtmlSelection {
  return { sid, rect: rectField(record.rect), nodeName: nodeNameField(record.nodeName) };
}

/**
 * Fold one forwarded preview event into the selection state.
 *
 * Anything that is not a well-formed `select` / `hover` / `rect` message -
 * including every other inspector type (`ready`, `resize`, `text-edit-commit`)
 * - leaves the state untouched, and the identity of the returned state is
 * preserved so React can bail out of the re-render.
 */
export function reduceSelection(state: HtmlSelectionState, event: unknown): HtmlSelectionState {
  if (event === null || typeof event !== "object" || Array.isArray(event)) return state;
  const record = event as Record<string, unknown>;
  if (typeof record.type !== "string") return state;

  if (record.type === "select") {
    const sid = sidField(record.sid);
    if (!sid.ok) return state;
    if (sid.sid === null) return state.selected === null ? state : { ...state, selected: null };
    return { ...state, selected: entry(sid.sid, record) };
  }

  if (record.type === "hover") {
    const sid = sidField(record.sid);
    if (!sid.ok) return state;
    if (sid.sid === null) return state.hovered === null ? state : { ...state, hovered: null };
    return { ...state, hovered: entry(sid.sid, record) };
  }

  if (record.type === "rect") {
    const sid = sidField(record.sid);
    if (!sid.ok || sid.sid === null) return state;
    const rect = rectField(record.rect);
    if (rect === null) return state;
    const selected = state.selected !== null && state.selected.sid === sid.sid ? { ...state.selected, rect } : state.selected;
    const hovered = state.hovered !== null && state.hovered.sid === sid.sid ? { ...state.hovered, rect } : state.hovered;
    if (selected === state.selected && hovered === state.hovered) return state;
    return { selected, hovered };
  }

  return state;
}

/**
 * A tiny synchronous event fan-out: the shell owns one sink and forwards every
 * preview event into it, the selection surface subscribes. Keeping the stream
 * out of React state means a hover-frequency event re-renders the surface
 * alone, never the shell or the preview pane.
 */
export interface PreviewEventSink {
  emit(event: unknown): void;
  subscribe(listener: (event: unknown) => void): () => void;
}

export function createPreviewEventSink(): PreviewEventSink {
  const listeners = new Set<(event: unknown) => void>();
  return {
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // One broken subscriber must not stop the stream for the others.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
