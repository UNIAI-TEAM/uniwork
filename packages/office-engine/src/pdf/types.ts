// PDF op input types — ported from office-upstream apps/pdf/src/shared/ipc.ts,
// trimmed to the G2-05 scope (text/image/page edits, markups, drawings, ink,
// annot deletes, metadata).
// Coordinates are PDF user space points (y up); page indices are 0-based.

/** Stroke width of a synthetic-bold run as a fraction of the em. Bold on the
    document's own face is a same-color fill+stroke (advances unchanged, layout
    survives); only an explicit edit font loads a real bold face. */
export const SYNTHETIC_BOLD_STROKE_EM = 0.035;

export const EDIT_FONTS = [
  { id: "noto", label: "Noto Sans", css: "'Noto Sans', sans-serif" },
  { id: "arial", label: "Arial", css: "Arial, 'Helvetica Neue', sans-serif" },
  { id: "times", label: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { id: "courier", label: "Courier New", css: "'Courier New', monospace" },
] as const;

export type MarkupType = "highlight" | "underline" | "strikeout";

/** Authoring primitives kept as PDF annotations so content streams are never rewritten. */
export type DrawingKind = "rect" | "ellipse" | "line" | "arrow" | "ink";
export type DrawingType = Exclude<DrawingKind, "ink">;
export type DrawingGeometry =
  | { rect: { x: number; y: number; width: number; height: number } }
  | { start: { x: number; y: number }; end: { x: number; y: number } }
  | { points: { x: number; y: number }[] };

export interface DrawingInput {
  pageIndex: number;
  kind: DrawingKind;
  geometry: DrawingGeometry;
  color: [number, number, number];
  width: number;
  fill?: [number, number, number];
}

/** Freehand ink is one or more open paths, each flattened as [x,y,...]. */
export type InkInput = DrawingInput;

/** A text selection annotation. Quads are PDF user-space points (y up), in
 * [x1,yTop,x2,yTop,x1,yBottom,x2,yBottom] groups. RGB channels are normalized. */
export interface MarkupInput {
  pageIndex: number;
  type: MarkupType;
  color: [number, number, number];
  quads: number[][];
}

/** Reply target: a note (Text) annotation saved in the file. The object number
    is only a lookup hint — pdfium stages that run before pdf-lib may renumber
    objects — so the parent is confirmed by rect + contents at write time. */
export interface NoteReplyTarget {
  objNum: number;
  rect: [number, number, number, number];
  contents: string;
}

/** A sticky-note comment saved as a standard Text annotation (viewers draw the
    icon; no appearance stream is written). Replies chain through /IRT + /RT. */
export interface NoteInput {
  pageIndex: number;
  /** Annotation /Rect in PDF user space (icon bounds, y up) */
  rect: [number, number, number, number];
  contents: string;
  /** Annotation author (/T); omitted → 'UniWork' */
  author?: string;
  /** Creation time (ms since epoch) → /CreationDate and /M; omitted → save time */
  createdMs?: number;
  /** Key for parenting replies inside the same request (parents sort before children) */
  localId?: string;
  /** This note replies to a note saved in the file */
  replyTo?: NoteReplyTarget;
  /** This note replies to another note in this request, by its localId */
  replyToLocalId?: string;
}

/** Rewrite the /Contents of a note saved in the file, in place — the object keeps
    its number so saved replies' /IRT chains stay intact (unlike delete + re-add).
    Identity matches like NoteReplyTarget: rect + current contents, with the object
    number as a tie-break hint. */
export interface NoteEditInput {
  pageIndex: number;
  objNum: number;
  rect: [number, number, number, number];
  /** /Contents currently in the file (identity match) */
  oldContents: string;
  contents: string;
}

/** Review state of a saved note (PDF review state model: /StateModel /Review with
    /State /Completed or /None). Upstream's save-pdf port has no resolve semantics;
    this is the closest standard contract. */
export interface NoteResolveInput {
  pageIndex: number;
  objNum: number;
  rect: [number, number, number, number];
  contents: string;
  resolved: boolean;
}

/** Delete an annotation already saved in the file. Object number is only a lookup
    hint; subtype + rect guard against (and recover from) object renumbering by a
    rewrite. 'note' targets Text (comment) annotations. */
export interface AnnotDeleteInput {
  pageIndex: number;
  /** PDF object number (pdf.js annotation id "123R" → 123) */
  objNum: number;
  subtype: MarkupType | "note";
  /** Annotation /Rect in PDF user space, for fallback matching */
  rect: [number, number, number, number];
  /** /Contents to match. Required identity for notes: every comment of a thread
      shares the root's rect, so rect alone would delete the wrong member. */
  contents?: string;
}

/** Document info; an empty string clears the field */
export interface MetadataInput {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

/** Content-stream text replacement (pdfium). Callers only know layout rects;
    the engine re-locates the actual text objects by rect intersection and
    verifies against oldText, because one layout item may span many objects. */
export interface TextEditInput {
  pageIndex: number;
  /** PDF user space [x1,y1,x2,y2] of the run being replaced */
  rect: [number, number, number, number];
  /** Text currently displayed in rect; matching is whitespace-insensitive */
  oldText: string;
  /** Replacement; '\n' splits it into stacked lines (one text object per line) */
  newText: string;
  /** Original run's font size in PDF pt (fallback sizing for the rebuilt object) */
  fontSize: number;
  /** User-chosen size in PDF pt; absent = keep the original run's size */
  newFontSize?: number;
  /** User-chosen fill color (0-255 RGB); absent = keep the original run's color */
  newColor?: [number, number, number];
  /** Selection-level fill colors: [start,end) code-unit ranges into newText.
      Legacy input form — new senders use styleRuns; still accepted. */
  colorRuns?: { start: number; end: number; color: [number, number, number] }[];
  /** Selection-level style overrides: [start,end) code-unit ranges into newText,
      ascending and non-overlapping. Each present field overrides the whole-edit
      value for the covered range; absent fields inherit it. */
  styleRuns?: {
    start: number;
    end: number;
    color?: [number, number, number];
    font?: string;
    size?: number;
    bold?: boolean;
    italic?: boolean;
  }[];
  /** User-chosen rebuild font (EDIT_FONTS id); absent = keep the original font
      (embedded subset when it covers the replacement, else the same-named
      installed/bundled font, else fallback). */
  newFont?: string;
  /** Baseline origin (PDF user space) for the rebuilt first line. Absent = the
      anchor object's own position. Ignored on fragment matches. */
  origin?: [number, number];
  /** Baseline-to-baseline step between '\n' lines in PDF pt; absent = fontSize × 1.2 */
  lineLeading?: number;
  /** Per-'\n'-line horizontal offset from origin.x in PDF pt */
  lineXOffsets?: number[];
  align?: "left" | "center" | "right";
  /** Bold/italic for the rebuilt run, resolved via font variants. */
  newBold?: boolean;
  newItalic?: boolean;
  /** Move the matched run as-is instead of rewriting it: every matched text
      object is translated by this delta. Requires a whole-run match; newText
      must be textually equivalent to oldText. */
  translate?: [number, number];
}

/** A new searchable/selectable text object inserted into a page content stream. */
export interface TextInsertInput {
  pageIndex: number;
  /** First-line baseline origin in PDF user space. */
  origin: [number, number];
  /** Text to insert; '\n' creates stacked text objects. */
  text: string;
  fontSize: number;
  color: [number, number, number];
  font?: string;
  bold?: boolean;
  italic?: boolean;
  lineLeading?: number;
  lineXOffsets?: number[];
  align?: "left" | "center" | "right";
  /** Final displayed page rotation; the insertion matrix counter-rotates. */
  rotate?: number;
}

/** Target z-band for a content-stream image: under every text run (above the
    page background) or on top of the page's content */
export type ImageLayer = "belowText" | "aboveText";

/** Content-stream image operations (pdfium). Existing images are addressed by
    their bounds as reported by listPageImages — re-matched by rect at save time
    (fail-soft, like text edits), since object indices shift. */
export type ImageEditInput =
  | {
      kind: "insertImage";
      pageIndex: number;
      /** base64 PNG or JPEG, without the data: prefix */
      image: string;
      /** PDF user space [x1,y1,x2,y2] footprint */
      rect: [number, number, number, number];
      layer: ImageLayer;
      /** Final display rotation of the page (0/90/180/270) */
      rotate?: number;
    }
  | {
      kind: "transformImage";
      pageIndex: number;
      oldRect: [number, number, number, number];
      rect: [number, number, number, number];
      layer?: ImageLayer;
      quarterTurns?: number;
    }
  | {
      kind: "replaceImage";
      pageIndex: number;
      oldRect: [number, number, number, number];
      rect: [number, number, number, number];
      /** base64 PNG or JPEG replacing the image's pixels */
      image: string;
      layer?: ImageLayer;
      quarterTurns?: number;
    }
  | { kind: "deleteImage"; pageIndex: number; oldRect: [number, number, number, number] };

/** An existing content-stream image on a page */
export interface PageImageRef {
  pageIndex: number;
  /** PDF user space [x1,y1,x2,y2] */
  rect: [number, number, number, number];
  /** Painted after the page's first text run (i.e. covers text it overlaps) */
  aboveText: boolean;
}

/** A text edit that could not be matched to the document and was skipped */
export interface TextEditFailure {
  pageIndex: number;
  oldText: string;
  reason: string;
}
export interface TextInsertFailure {
  editIndex: number;
  pageIndex: number;
  reason: string;
}
/** An image edit that could not be matched to the document and was skipped */
export interface ImageEditFailure {
  editIndex: number;
  pageIndex: number;
  reason: string;
}

/** Dry-run match result for one pending text edit */
export interface TextEditValidation {
  /** null = the edit would apply; string = reason it would be skipped */
  reason: string | null;
  /** Ink bounds [x1,y1,x2,y2] of the matched text objects (PDF user space) */
  bounds?: [number, number, number, number];
  colorRuns?: { start: number; end: number; color: [number, number, number] }[];
  baseColor?: [number, number, number];
}

/** Render request for a page region with some objects removed (in memory —
    the file is untouched): used for before/after render diffs, not previews. */
export interface PageRenderRequest {
  pageIndex: number;
  /** Images to erase, addressed by their listed rects (PDF user space) */
  excludeRects?: [number, number, number, number][];
  /** Saved annotations to erase */
  excludeAnnots?: AnnotDeleteInput[];
  /** Region to render, in display coords at scale 1 (after total rotation, y down) */
  clip: { x: number; y: number; width: number; height: number };
  /** Output bitmap width in px (height follows the clip aspect) */
  pxWidth: number;
  /** Extra display rotation on top of the page's /Rotate: 0-3 quarter turns cw */
  rotate?: number;
}

/** Insert one blank page after `afterPageIndex` in the original document
    (-1 = front). Absent `width`/`height` copy the neighboring page's size and
    /Rotate, so the blank sheet matches its neighbor instead of shrinking or
    displaying sideways. */
export interface InsertBlankPageInput {
  /** Original 0-based page index the blank page goes after; -1 = front. */
  afterPageIndex: number;
  /** Explicit page size in PDF points; both or neither. */
  width?: number;
  height?: number;
}

/** Insert pages of another PDF after `afterPageIndex` (-1 = front). The bytes
    arrive base64-encoded because the browser resolves an asset id through
    `PdfAssetProvider` and never touches a Node codec; the host owns the bytes. */
export interface InsertPdfPagesInput {
  afterPageIndex: number;
  /** Source PDF, base64 without a data: prefix. */
  pdf: string;
  /** Source page indices to insert (0-based, in order); absent = every page. */
  pages?: number[];
}

/** Extract pages (original 0-based indices, in order) into a NEW document. */
export interface ExtractPagesInput {
  pages: number[];
  /** Suggested output name stem (no extension); the host commits the document. */
  name?: string;
}

/** Append the pages of other PDFs (base64, in order) to this document and
    produce a NEW document. */
export interface MergePdfsInput {
  pdfs: string[];
  name?: string;
}

/** Split into consecutive chunks of `chunkSize` pages, each a NEW document. */
export interface SplitPdfInput {
  chunkSize: number;
  name?: string;
}

/** A document produced by a page op (extract / merge / split). The engine never
    writes it anywhere: F2 requires the host to persist it through a Documents
    commit, so this carries bytes plus the suggested name and nothing else. */
export interface PdfNewDocument {
  op: "extractPages" | "mergePdfs" | "splitPdf";
  /** Suggested filename stem, extension excluded. */
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  /** 1-based part ordinal for split output; absent for single-document ops. */
  part?: number;
}

/** A page op that produced no document and was skipped, with the reason. */
export interface PageOpFailure {
  /** Op name from the wire vocabulary (e.g. "extractPages"). */
  op: string;
  /** Index within that op's request list, or 0 for single-item ops. */
  index: number;
  reason: string;
}

/** The batch an edit job carries — the G2-05-scoped subset of upstream
    SavePdfRequest. Forms remain outside this lane. */
export interface PdfEditRequest {
  markups?: MarkupInput[];
  drawings?: DrawingInput[];
  notes?: NoteInput[];
  /** In-place /Contents rewrites of saved notes, applied after the note stage so
      same-request replies still match their parent by its old contents. */
  noteEdits?: NoteEditInput[];
  /** Review-state writes on saved notes, applied after note edits. */
  noteResolves?: NoteResolveInput[];
  /** Saved markup annotations to remove (applied before every other stage) */
  annotDeletes?: AnnotDeleteInput[];
  textEdits?: TextEditInput[];
  textInserts?: TextInsertInput[];
  imageEdits?: ImageEditInput[];
  /** Page rotation deltas (original page index → multiple of 90 clockwise) */
  rotations?: { pageIndex: number; delta: number }[];
  /** Pages to delete (original page indices) */
  deletedPages?: number[];
  /** New page order (array of original page indices, excluding deleted) */
  pageOrder?: number[];
  /** Blank pages to insert, in request order (applied after deletion/reorder). */
  blankPages?: InsertBlankPageInput[];
  /** Pages of other PDFs to insert, in request order. */
  insertedPdfs?: InsertPdfPagesInput[];
  /** Produce a new document holding just these pages (read from the saved output). */
  extractPages?: ExtractPagesInput;
  /** Produce a new document appending other PDFs' pages to the saved output. */
  mergePdfs?: MergePdfsInput;
  /** Produce N new documents, one per consecutive chunk of the saved output. */
  splitPdf?: SplitPdfInput;
  metadata?: MetadataInput;
}
