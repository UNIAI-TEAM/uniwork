// PPTX engine seam — structural types the adapter actually reads/writes.
//
// Real upstream signatures this seam mirrors (genoffice pinned at
// 09485f884dc845cf3bf27fb7edfe489f9d457aad — READ ONLY, never imported):
//   openPptx(bytes: Uint8Array): Promise<OpenedPptx>
//       packages/pptx-engine/src/index.ts:632
//   reparseDeck(opened: OpenedPptx): OpenedPptx
//       packages/pptx-engine/src/index.ts:652
//   savePptx(opened: OpenedPptx): Promise<Uint8Array>
//       packages/pptx-engine/src/index.ts:674
//   commitSaved(opened: OpenedPptx): void
//       packages/pptx-engine/src/index.ts:718
//   runTxn(opened: OpenedPptx, req: TxnRequest): TxnResult
//       packages/pptx-ops/src/ops/executor.ts:160
//       (TxnRequest/TxnResult executor.ts:55-85; Op/OpTarget registry.ts:151-177)
//   buildRenderSlide(slide, size, opts): RenderSlide
//       packages/pptx-render/src/render-tree.ts:543
//   listSlideLayouts(archive), shouldOfferBuiltinLayouts, builtinLayoutInfos
//       packages/pptx-engine/src/index.ts (layouts surface)
//
// Only the fields this adapter reads or writes are declared; nothing here is
// a substitute for the real modules.

// ── model surface ─────────────────────────────────────────────────────────

/** @public — EMU rect (registry setTransform geometry). */
export interface PptxEmuRect {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

/** @public — run surface the adapter reads/writes. */
export interface PptxRunLike {
  text?: string;
  [key: string]: unknown;
}

export interface PptxParagraphLike {
  runs?: PptxRunLike[];
  [key: string]: unknown;
}

/** SlideElement — upstream types; the adapter needs id/type/transform/text
 * for targeting + journaling only. */
export interface PptxElementLike {
  id: string;
  type: string;
  transform?: { offset: PptxEmuRect; rot?: number };
  text?: { paragraphs?: PptxParagraphLike[] };
  [key: string]: unknown;
}

export interface PptxSlideLike {
  id?: string;
  hidden?: boolean;
  elements: PptxElementLike[];
  [key: string]: unknown;
}

/** @public — deck surface the model mutates. */
export interface PptxDeckLike {
  size?: { cx: number; cy: number };
  slides: PptxSlideLike[];
  [key: string]: unknown;
}

/** @public — package archive view for asset/diff oracles. */
export interface PptxArchiveLike {
  entries?: Map<string, unknown> | Record<string, unknown>;
  readBytes?(path: string): Uint8Array | undefined;
  readText?(path: string): string | undefined;
  [key: string]: unknown;
}

/** OpenedPptx — the opaque session handle runTxn/savePptx share. */
export interface OpenedPptxLike {
  deck: PptxDeckLike;
  archive?: PptxArchiveLike;
  [key: string]: unknown;
}

// ── transaction surface ───────────────────────────────────────────────────

/** OpTarget — registry.ts:151-177: slide (0-based index or "s_<n>" durable
 * id), el (element id), part (master/layout part), rev. @public */
export interface PptxOpTarget {
  slide?: number | string;
  el?: string;
  part?: string;
  rev?: number;
  [key: string]: unknown;
}

/** Op — loose by design (registry has 40+ op kinds); the adapter builds the
 * vocabulary it implements and lets the executor guide the rest. */
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

/** TxnRequest/TxnResult — executor.ts:55-85. */
export interface PptxTxnRequest {
  isolation?: "atomic" | "per_op";
  dryRun?: boolean;
  parts?: [string, unknown][];
  ops: PptxOp[];
}

export interface PptxTxnResult {
  applied: boolean;
  dryRun?: boolean;
  plan?: string[];
  records?: PptxOpRecord[];
  failures?: PptxOpFailure[];
}

/** @public — runTxn signature (transactions.ts runTxn). */
export type PptxRunTxn = (opened: OpenedPptxLike, req: PptxTxnRequest) => PptxTxnResult;

// ── seam interfaces ───────────────────────────────────────────────────────

/** packages/pptx-engine surface (index.ts:632-718). */
export interface PptxEngineFunctions {
  openPptx(bytes: Uint8Array): Promise<OpenedPptxLike>;
  savePptx(opened: OpenedPptxLike): Promise<Uint8Array>;
  /** Mark saved state as the new base (index.ts:718) — call after a
   * successful save so save #2 diffs against the new bytes. */
  commitSaved?(opened: OpenedPptxLike): void;
  /** Full re-parse of the held deck (index.ts:652) — verification helper. */
  reparseDeck?(opened: OpenedPptxLike): OpenedPptxLike;
  /** Layout catalog for the new-slide picker (read-only). */
  listSlideLayouts?(archive: unknown): Array<{ name: string; path: string }>;
  shouldOfferBuiltinLayouts?(layouts: Array<{ name: string; path: string }>): boolean;
  builtinLayoutInfos?(size: { cx: number; cy: number }, existing: Set<string>): Array<{ name: string; path: string }>;
  /** Speaker-notes text of a slide part (notes.ts:66) - '' when the slide
   * carries no notesSlide. Optional: a host that never wires the vendored
   * read leaves it unbound and the adapter refuses with a typed
   * notes_unbound, never a fabricated empty string. */
  getSlideNotes?(archive: unknown, slidePath: string): string;
  /** Parse a master/layout part into its editable element tree
   * (master-edit.ts:72). Optional: unbound => masterElements refuses with a
   * typed master_unbound, never an invented empty element list. */
  parseMasterPart?(archive: unknown, partPath: string): PptxMasterPartLike | null;
}

/** The slice of a vendored parsed master/layout part (a Slide, types.ts:675)
 * that the element reader needs; ids are the parse-time ids the part-addressed
 * ops target. */
export interface PptxMasterPartLike {
  elements: PptxElementLike[];
  [key: string]: unknown;
}

/** packages/pptx-ops executor (executor.ts:160). */
export interface PptxOpsFunctions {
  runTxn: PptxRunTxn;
}

/** packages/pptx-render port (render-tree.ts:543) — optional: without it the
 * slides-edit channels answer a typed "unbound" refusal, never a fabricated
 * RenderSlide. */
export interface PptxRenderPort {
  buildRenderSlide(opened: OpenedPptxLike, slideIndex: number, fitWidthPx: number): Promise<Record<string, unknown>>;
}

/** Typed model/adapter errors — a caller branches on `code`, never on text. */
export class PptxEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PptxEngineError";
    this.code = code;
  }
}
