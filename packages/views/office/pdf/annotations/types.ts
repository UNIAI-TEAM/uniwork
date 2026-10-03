/** PDF user-space annotation rectangle: [x1, y1, x2, y2]. */
export type PdfAnnotationRect = readonly [number, number, number, number];

/** Annotation subtypes the PDF save contract can identify and remove safely. */
export type PdfSavedAnnotationSubtype = "highlight" | "underline" | "strikeout" | "note";

/** The browser-safe identity needed by the host's guarded deleteSavedAnnot op. */
export interface PdfSavedAnnotationIdentity {
  pageIndex: number;
  objNum: number;
  subtype: PdfSavedAnnotationSubtype;
  rect: PdfAnnotationRect;
  contents?: string;
}

/** A saved PDF annotation row. Unknown and drawing kinds are intentionally
 * representable so the panel can show them without pretending they are editable. */
export interface PdfSavedAnnotation {
  id: string;
  page: number;
  kind: string;
  /** Hosts may expose a known subtype as unbound while its serializer is unavailable. */
  binding?: "bound" | "unbound";
  contents?: string;
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
  submit(operations: readonly PdfDeleteSavedAnnotOperation[]) : Promise<void> | void;
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
