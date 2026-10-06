/**
 * Pure model for the HTML editor shell: the view-mode cycle, the zoom ladder
 * and the status-bar figures. No React, no DOM - so the arithmetic the shell
 * and its tests rely on lives in one testable place.
 *
 * The shell itself owns the panes and the injected preview port; this module
 * only answers "what comes next" and "what does the status bar say".
 */

/** The four modes, in cycle order. `present` is a fullscreen preview. */
export const HTML_VIEW_MODES = ["source", "split", "preview", "present"] as const;

export type HtmlViewMode = (typeof HTML_VIEW_MODES)[number];

/** Zoom is a whole percentage: 100 = natural size. */
export const HTML_ZOOM_DEFAULT = 100;
export const HTML_ZOOM_MIN = 25;
export const HTML_ZOOM_MAX = 400;
export const HTML_ZOOM_STEP = 10;

/** The mode `Ctrl+\` moves to: source -> split -> preview -> present -> source. */
export function nextViewMode(current: HtmlViewMode): HtmlViewMode {
  const index = HTML_VIEW_MODES.indexOf(current);
  const next = index === -1 ? 0 : (index + 1) % HTML_VIEW_MODES.length;
  return HTML_VIEW_MODES[next] ?? "source";
}

/** True when the mode shows the injected preview pane. */
export function previewVisibleIn(mode: HtmlViewMode): boolean {
  return mode === "split" || mode === "preview" || mode === "present";
}

/** True when the mode shows the CodeMirror source pane. */
export function sourceVisibleIn(mode: HtmlViewMode): boolean {
  return mode === "source" || mode === "split";
}

export function clampZoom(percent: number): number {
  if (!Number.isFinite(percent)) return HTML_ZOOM_DEFAULT;
  return Math.min(HTML_ZOOM_MAX, Math.max(HTML_ZOOM_MIN, Math.round(percent)));
}

/** One step of the − / + control; the ladder is clamped, never wrapped. */
export function stepZoom(percent: number, direction: 1 | -1): number {
  return clampZoom(percent + direction * HTML_ZOOM_STEP);
}

export interface HtmlStatusFigures {
  /** Source length in characters, exactly as the raw text holds them. */
  length: number;
  /** 1-based line count; an empty document is one line. */
  lines: number;
  /** The source selection in character offsets, or null when nothing is selected. */
  selection: { from: number; to: number } | null;
}

/** The status bar's format-appropriate figures for HTML source. */
export function htmlStatusFigures(
  text: string,
  selection: { from: number; to: number } | null,
): HtmlStatusFigures {
  const lines = text.length === 0 ? 1 : text.split("\n").length;
  const hasSelection = selection !== null && selection.to > selection.from;
  return { length: text.length, lines, selection: hasSelection ? selection : null };
}
