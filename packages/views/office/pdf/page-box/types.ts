/** Target box of a page in the PDF page tree: `media` is the physical sheet,
    `crop` the visible window a viewer shows. */
export type PdfPageBoxKind = "media" | "crop";

/** Paper presets N-up imposition can target; absent keeps the sheet size. */
export type PdfPageBoxPaper = "a4" | "letter";

/** A page box in PDF points, `[left, bottom, right, top]` from the page origin. */
export type PdfPageBoxRect = [number, number, number, number];

/** N-up grid: rows down the sheet, columns across it. */
export interface PdfPageBoxLayout {
  rows: number;
  cols: number;
}

/** One `setPageBox` request before validation. `pages` are 1-based displayed
    page numbers — the shape the page rail hands the dialog — and the host
    resolves them against the current display order, exactly as the ops bridge
    does for its own envelopes. */
export interface PdfPageBoxSetPageBoxInput {
  pages: readonly number[];
  box: PdfPageBoxKind;
  rect: PdfPageBoxRect;
}

/** One `setNUp` request before validation. `paper` is absent when the sheet
    keeps the size it already has. */
export interface PdfPageBoxSetNUpInput {
  pages: readonly number[];
  layout: PdfPageBoxLayout;
  paper?: PdfPageBoxPaper;
}

/** The JSON envelopes the engine parses, one per user action. Kept local so a
    browser bundle never imports the Node PDF implementation. */
export type PdfPageBoxEngineOperation =
  | { op: "setPageBox"; pages: number[]; box: PdfPageBoxKind; rect: PdfPageBoxRect }
  | { op: "setNUp"; pages: number[]; layout: PdfPageBoxLayout; paper?: PdfPageBoxPaper };

/** Host/provider contract. The view never serializes and never imports a codec. */
export interface PdfPageBoxOperationProvider {
  setPageBox(input: PdfPageBoxSetPageBoxInput): Promise<void> | void;
  setNUp(input: PdfPageBoxSetNUpInput): Promise<void> | void;
}

/** Serialisable envelope sink owned by the host. */
export interface PdfPageBoxOperationSubmitter {
  submit(operations: readonly PdfPageBoxEngineOperation[]): Promise<void> | void;
}

export interface PdfPageSizeDialogProps {
  open: boolean;
  /** 1-based displayed page numbers, in display order (same shape as the page rail). */
  pages: readonly number[];
  provider: PdfPageBoxOperationProvider;
  disabled?: boolean;
  /** Sheet used to compute the rectangle presets; A4 points when the host has none. */
  pageSize?: { width: number; height: number };
  onOpenChange: (open: boolean) => void;
  /** Fired after a batch the host applied, before the dialog closes. */
  onApplied?: () => void;
}

export interface PdfNUpDialogProps {
  open: boolean;
  /** 1-based displayed page numbers, in display order (same shape as the page rail). */
  pages: readonly number[];
  provider: PdfPageBoxOperationProvider;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a batch the host applied, before the dialog closes. */
  onApplied?: () => void;
}
