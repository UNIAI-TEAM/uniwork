/** PDF user-space annotation rectangle: [x1, y1, x2, y2]. */
export type PdfAnnotationRect = readonly [number, number, number, number];

/** Annotation subtypes the PDF save contract can identify and remove safely. */
export type PdfSavedAnnotationSubtype = "highlight" | "underline" | "strikeout" | "note";

/** The browser-safe identity needed by the host's guarded deleteSavedAnnot op.
 * `pageIndex` is the original 0-based page index in the file, never the page
 * number the host displays: a host that shows pages in another order must map
 * back before emitting, because the engine matches the annotation on it. */
export interface PdfSavedAnnotationIdentity {
  pageIndex: number;
  objNum: number;
  subtype: PdfSavedAnnotationSubtype;
  rect: PdfAnnotationRect;
  /** /Contents matched by the engine. Required for `note` deletions: every
      comment of a thread shares the root rect, so contents is the only
      discriminator between thread members. */
  contents?: string;
}

/** A saved PDF annotation row. Unknown and drawing kinds are intentionally
 * representable so the panel can show them without pretending they are editable. */
export interface PdfSavedAnnotation {
  id: string;
  /** 1-based page number as displayed by the host (display only). The delete
      identity uses `pageIndex`, the original 0-based index. */
  page: number;
  kind: string;
  /** Hosts may expose a known subtype as unbound while its serializer is unavailable. */
  binding?: "bound" | "unbound";
  /** /Contents of the annotation. Required for `kind === "note"`: the engine
      disambiguates thread members by contents, since they share the root rect. */
  contents?: string;
  /** Original 0-based page index in the file (identity), not the page's
      position in a reordered display. */
  pageIndex?: number;
  objNum?: number;
  rect?: PdfAnnotationRect;
}

/** Serialisable envelope handed to the host submitter. */
export interface PdfDeleteSavedAnnotOperation {
  op: "deleteSavedAnnot";
  attributes: PdfSavedAnnotationIdentity;
}

export interface PdfAnnotationOperationProvider {
  deleteSavedAnnot(input: PdfSavedAnnotationIdentity): Promise<void> | void;
}

export interface PdfAnnotationOperationSubmitter {
  submit(operations: readonly PdfDeleteSavedAnnotOperation[]): Promise<void> | void;
}

export type PdfDeleteSavedAnnot = (input: PdfSavedAnnotationIdentity) => Promise<void> | void;

export interface PdfAnnotationsPanelProps {
  annotations: readonly PdfSavedAnnotation[];
  /** A host callback for the guarded browser-safe delete operation. */
  deleteSavedAnnot?: PdfDeleteSavedAnnot;
  /** Provider form for hosts that submit typed engine envelopes. */
  provider?: PdfAnnotationOperationProvider;
  disabled?: boolean;
  className?: string;
}
