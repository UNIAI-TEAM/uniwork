/** PDF user-space annotation rectangle: [x1, y1, x2, y2]. */
export type PdfNoteRect = [number, number, number, number];

/** A saved note (Text annotation) addressed by the identity the engine guards
 * deletion/rewrite with. `pageIndex` is the original 0-based file index, never
 * a displayed page number: the engine matches the note on that page by
 * rect + contents, so mapping a displayed position here would address the
 * wrong note on a reordered file. */
export interface PdfNoteIdentity {
  pageIndex: number;
  objNum: number;
  rect: PdfNoteRect;
  contents: string;
}

/** Reply target: a note (Text) annotation already saved in the file. Mirrors
 * the engine's NoteReplyTarget, so it carries no pageIndex - a reply's page
 * always follows its parent, which the bridge resolves from the parent's
 * identity rather than from this target. `objNum` is a lookup hint; the
 * engine confirms the parent by rect + contents at write time. */
export interface PdfNoteReplyTarget {
  objNum: number;
  rect: PdfNoteRect;
  contents: string;
}

/** One thread member as the host reports it from the saved file. */
export interface PdfNoteRow extends PdfNoteIdentity {
  /** Host-provided stable row key. */
  id: string;
  /** 1-based page number as displayed by the host (display only). */
  page: number;
  author?: string;
  /** Hosts mark a note they cannot act on as unbound; the panel renders it read-only. */
  binding?: "bound" | "unbound";
  /** Review state read from /State (/Completed); absent = not resolved. */
  resolved?: boolean;
}

export interface PdfNoteThread {
  id: string;
  root: PdfNoteRow;
  replies: readonly PdfNoteRow[];
}

export interface PdfNoteAddInput {
  /** Original 0-based page index in the file (never a displayed position). */
  pageIndex: number;
  rect: PdfNoteRect;
  contents: string;
  author?: string;
}

/** A reply's page and rect always follow its parent, so they are derived from
 * the target instead of being accepted separately. */
export interface PdfNoteReplyInput {
  replyTo: PdfNoteIdentity;
  contents: string;
  author?: string;
}

export interface PdfNoteEditInput {
  identity: PdfNoteIdentity;
  contents: string;
}

export interface PdfNoteResolveInput {
  identity: PdfNoteIdentity;
  resolved: boolean;
}

/** Serialisable envelopes for the host submitter. */
export interface PdfNoteAddOperation {
  op: "addNote";
  attributes: { note: { pageIndex: number; rect: PdfNoteRect; contents: string; author?: string; replyTo?: PdfNoteReplyTarget } };
}

export interface PdfNoteEditOperation {
  op: "editSavedNote";
  attributes: { pageIndex: number; objNum: number; rect: PdfNoteRect; oldContents: string; contents: string };
}

export interface PdfNoteResolveOperation {
  op: "resolveNote";
  attributes: { pageIndex: number; objNum: number; rect: PdfNoteRect; contents: string; resolved: boolean };
}

export type PdfNoteEngineOperation = PdfNoteAddOperation | PdfNoteEditOperation | PdfNoteResolveOperation;

export interface PdfNoteOperationProvider {
  addNote(input: PdfNoteAddInput): Promise<void> | void;
  replyToNote(input: PdfNoteReplyInput): Promise<void> | void;
  editNote(input: PdfNoteEditInput): Promise<void> | void;
  resolveNote(input: PdfNoteResolveInput): Promise<void> | void;
}

export interface PdfNoteOperationSubmitter {
  submit(operations: readonly PdfNoteEngineOperation[]): Promise<void> | void;
}

export interface PdfNoteAddTarget {
  /** Original 0-based page index in the file. */
  pageIndex: number;
  rect: PdfNoteRect;
  /** 1-based displayed page for the form copy; display only. */
  page?: number;
}

export interface PdfNotesPanelProps {
  threads: readonly PdfNoteThread[];
  provider?: PdfNoteOperationProvider;
  /** Shows the compose form for a new root note at this anchor. */
  addTarget?: PdfNoteAddTarget | null;
  disabled?: boolean;
  className?: string;
  onApplied?: () => void;
}
