// DOC-003 engine host: PPTX engine shapes shared by the route module and its tests.
//
// These mirror the real upstream contracts (packages/pptx-ops/src/types.ts,
// packages/pptx-ops/src/ops/registry.ts, packages/pptx-ops/src/ops/executor.ts,
// packages/pptx-engine + packages/pptx-render). Only the fields this host reads
// or writes are declared; nothing here is a substitute for the real module.

export interface PptxOpRecord {
  op?: unknown;
  created?: string[];
  [key: string]: unknown;
}

export interface PptxOpFailure {
  index: number;
  op: unknown;
  error: string;
}

/** packages/pptx-ops src/ops/executor.ts TxnResult */
export interface PptxTxnResult {
  applied: boolean;
  dryRun?: boolean;
  records?: PptxOpRecord[];
  plan?: string[];
  failures?: PptxOpFailure[];
}

/** packages/pptx-ops src/ops/registry.ts Op: the field is "op", never "name". */
export interface PptxOp {
  op: string;
  target?: { slide?: number | string; el?: string; part?: string };
  [key: string]: unknown;
}

export interface PptxRunTxn {
  (opened: unknown, request: { ops: unknown[]; dryRun?: boolean; isolation?: "atomic" | "per_op" }): PptxTxnResult;
}

/** packages/pptx-ops src/types.ts EditRun / EditParagraph */
export interface PptxTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  [key: string]: unknown;
}

export interface PptxEditParagraph {
  runs: PptxTextRun[];
  align?: "left" | "center" | "right" | "justify";
  level?: number;
  bullet?: "char" | "number" | "blip" | "none";
  [key: string]: unknown;
}

export interface PptxDeckSize {
  cx: number;
  cy: number;
}

export interface PptxSlideLike {
  path: string;
  elements: PptxElementLike[];
}

export interface PptxDeck {
  slides: PptxSlideLike[];
  size?: PptxDeckSize;
}

export interface PptxElementLike {
  id: string;
  type: string;
  text?: { paragraphs?: { runs?: { text?: string }[] }[] };
  [key: string]: unknown;
}

export interface OpenedPptxLike {
  deck: PptxDeck;
  archive?: unknown;
}

export interface PptxEditTextInput {
  opened: OpenedPptxLike;
  slideIndex: number;
  elementId?: string;
  paragraphs: PptxEditParagraph[];
  groupId?: string;
}

export interface PptxEditTransformInput {
  opened: OpenedPptxLike;
  slideIndex: number;
  elementId: string;
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  rotationDeg: number;
  fitWidthPx: number;
  groupId?: string;
}

export interface PptxAddElementInput {
  opened: OpenedPptxLike;
  slideIndex: number;
  kind: string;
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  fitWidthPx: number;
  paragraphs?: PptxEditParagraph[];
  fillColor?: string;
  stroke?: { color: string; widthPt: number };
}

export interface PptxAddImageInput {
  opened: OpenedPptxLike;
  slideIndex: number;
  base64: string;
  ext: string;
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  fitWidthPx: number;
}

export interface PptxReplacePictureInput {
  opened: OpenedPptxLike;
  slideIndex: number;
  elementId: string;
  base64: string;
  ext: string;
  keepSrcRect?: boolean;
}

export interface PptxEditResult {
  applied: boolean;
  failures: PptxOpFailure[];
  targetId: string;
  targetType: string;
  records: PptxOpRecord[];
}

export interface PptxCreatedResult {
  applied: boolean;
  createdId: string;
}

/** Existing-element edits preserve their target id. */
export interface PptxTargetResult {
  applied: boolean;
  targetId: string;
}

/** One slideLayout as the renderer's new-slide picker consumes it (pptx-engine listSlideLayouts). */
export interface PptxLayoutInfo {
  path: string;
  name: string;
  layoutType: string;
  placeholders: Array<{
    type: string;
    idx: string;
    x: number;
    y: number;
    cx: number;
    cy: number;
    hint: string;
  }>;
}

/** The catalog the slides renderer mounts with: the deck layouts plus the built-in set. */
export interface PptxLayouts {
  layouts: PptxLayoutInfo[];
  size: { cx: number; cy: number };
}

export interface PptxEngine {
  open(bytes: Uint8Array): Promise<OpenedPptxLike>;
  save(opened: OpenedPptxLike): Promise<Uint8Array>;
  renderSlides(opened: OpenedPptxLike, fitWidthPx: number): Promise<unknown[]>;
  editText(input: PptxEditTextInput): Promise<PptxEditResult>;
  editTransform(input: PptxEditTransformInput): Promise<PptxTargetResult & { targetType: string }>;
  addElement(input: PptxAddElementInput): Promise<PptxCreatedResult>;
  addImageBytes(input: PptxAddImageInput): Promise<PptxCreatedResult>;
  replacePictureBytes(input: PptxReplacePictureInput): Promise<PptxTargetResult>;
  /** Read-only slideLayout catalog; never writes to the package. */
  listLayouts(opened: OpenedPptxLike): Promise<PptxLayouts>;
}

export interface PptxEngineDeps {
  loadTxn: () => PptxRunTxn;
  openPptx: (bytes: Uint8Array) => Promise<OpenedPptxLike>;
  savePptx: (opened: OpenedPptxLike) => Promise<Uint8Array>;
  buildRenderSlide: (opened: OpenedPptxLike, slideIndex: number, fitWidthPx: number) => Promise<unknown>;
  listLayouts: (opened: OpenedPptxLike) => Promise<PptxLayouts>;
}

export class PptxEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PptxEngineError";
    this.code = code;
  }
}
