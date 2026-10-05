// P0-1 (UNI-927) — typed surface of the generated browser artifact
// packages/office-upstream/dist/pptx-renderer.mjs (built by
// scripts/office/build-pptx-browser.mjs from shims/pptx-renderer-entry.ts).
//
// The vendored engine, op executor and render tree are plain TypeScript with
// no React/Node dependency of their own; this file names exactly the exports
// the artifact carries so the web host (bindPptxEngine / bindPptxOps /
// bindPptxRender in @uniwork/office-engine/pptx) and P0-2's canvas can import
// them without reaching into upstream sources.

// ── engine model surface ──────────────────────────────────────────────────

export interface PptxEmuRect {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export interface PptxRunLike {
  text?: string;
  [key: string]: unknown;
}

export interface PptxParagraphLike {
  runs?: PptxRunLike[];
  [key: string]: unknown;
}

export interface PptxElementLike {
  id: string;
  type: string;
  transform?: { offset: PptxEmuRect; rot?: number; [key: string]: unknown };
  text?: { paragraphs?: PptxParagraphLike[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PptxSlideLike {
  id?: string;
  hidden?: boolean;
  elements: PptxElementLike[];
  [key: string]: unknown;
}

export interface PptxDeckLike {
  size?: { cx: number; cy: number; [key: string]: unknown };
  slides: PptxSlideLike[];
  [key: string]: unknown;
}

export interface PptxArchiveLike {
  entries?: Map<string, unknown> | Record<string, unknown>;
  // Upstream answers `null` for a missing part; declared `undefined` so the
  // module stays structurally assignable to office-engine's PptxArchiveLike
  // seam (both are falsy and every caller tests truthiness).
  readBytes?(path: string): Uint8Array | undefined;
  readText?(path: string): string | undefined;
  [key: string]: unknown;
}

/** OpenedPptx — the handle openPptx/savePptx/runTxn share. */
export interface OpenedPptx {
  deck: PptxDeckLike;
  archive?: PptxArchiveLike;
  [key: string]: unknown;
}

export interface PptxOpTarget {
  slide?: number | string;
  el?: string;
  part?: string;
  rev?: number;
  [key: string]: unknown;
}

export interface PptxOp {
  op: string;
  target?: PptxOpTarget;
  [key: string]: unknown;
}

export interface PptxOpRecord {
  op: PptxOp;
  before?: unknown;
  after?: unknown;
  created?: string[];
  [key: string]: unknown;
}

export interface PptxOpFailure {
  index: number;
  op: PptxOp;
  error: string;
}

export interface PptxTxnRequest {
  isolation?: "atomic" | "per_op";
  dryRun?: boolean;
  /** Upstream passes a Map<string, Slide>; typed unknown so the seam does not
   * pin a structure neither host writes. */
  parts?: unknown;
  ops: PptxOp[];
}

export interface PptxTxnResult {
  applied: boolean;
  dryRun?: boolean;
  plan?: string[];
  records?: PptxOpRecord[];
  failures?: PptxOpFailure[];
}

export interface PptxSlideLayoutInfo {
  name: string;
  path: string;
}

// ── engine (packages/pptx-engine/src/index.ts) ────────────────────────────

export declare function openPptx(bytes: Uint8Array): Promise<OpenedPptx>;
export declare function savePptx(opened: OpenedPptx): Promise<Uint8Array>;
export declare function commitSaved(opened: OpenedPptx): void;
export declare function reparseDeck(opened: OpenedPptx): OpenedPptx;
/** Layout catalog for a new-slide picker; the archive comes from an opened deck. */
export declare function listSlideLayouts(archive: unknown): PptxSlideLayoutInfo[];

/** Speaker-notes text of a slide part ('' when the slide carries no notesSlide). */
export declare function getSlideNotes(archive: unknown, slidePath: string): string;

// ── ops (packages/pptx-ops/src/ops/executor.ts) ───────────────────────────

export declare function runTxn(opened: OpenedPptx, request: PptxTxnRequest): PptxTxnResult;

// ── render (packages/pptx-render) ─────────────────────────────────────────

export interface Viewport {
  widthPx: number;
  heightPx: number;
  scale: number;
}

export interface RenderSlide extends Record<string, unknown> {
  widthPx: number;
  heightPx: number;
  scale: number;
  background: unknown;
  bgOwn?: boolean;
  bgGraphicsHidden?: boolean;
  nodes: Array<Record<string, unknown> & { type: string }>;
  hidden?: boolean;
}

export interface BuildSlideOptions {
  fitWidthPx?: number;
  metrics?: unknown;
  media?: unknown;
  slideNo?: number;
}

export interface TextLayoutInput {
  [key: string]: unknown;
}

export interface RenderTextLayout extends Record<string, unknown> {
  lines?: unknown[];
  [key: string]: unknown;
}

/** Heuristic (no-canvas) metrics provider the artifact binds by default. */
export declare class HeuristicMetrics {
  constructor();
  metrics(style: Record<string, unknown>): Record<string, unknown>;
  measure(text: string, style: Record<string, unknown>): number;
}

export declare function makeViewport(size: { cx: number; cy: number }, fitWidthPx: number): Viewport;

export declare function buildRenderSlide(
  slide: PptxSlideLike,
  size: { cx: number; cy: number } | undefined,
  options: BuildSlideOptions,
): RenderSlide;

export declare function layoutText(input: TextLayoutInput): RenderTextLayout;

export interface PresetPathResult {
  d: string;
  [key: string]: unknown;
}

export declare function presetPath(
  preset: string | undefined,
  width: number,
  height: number,
  adjust?: Record<string, number>,
): PresetPathResult | null;

export declare function presetPolygon(
  preset: string | undefined,
  width: number,
  height: number,
  adjust?: Record<string, number>,
): number[] | null;
