import type {
  EditorHandle,
  OfficeCapabilityEntry,
  OfficeState,
  SaveAttemptResult,
  SaveCoordinatorState,
  StableSnapshot,
} from "@uniwork/core/office";
import type { OpenFailureClass, OpenOutcome } from "@uniwork/office-contracts";

/** A selection reported by the G3-01 host. The adapter owns the document
 * model; the view only keeps the identifier needed to label the active target. */
export interface DocxSelection {
  blockId: string | null;
  from: number;
  to: number;
}

export interface DocxSelectionPort {
  getSelection(): DocxSelection | null;
  subscribe?(listener: (selection: DocxSelection | null) => void): () => void;
}

/** The view consumes the G3-01 EditorHandle and the optional controls exposed
 * by a DOCX adapter. No engine or byte transport is reachable from JSX. */
export type DocxEditorHandle<TSnapshot = unknown> = EditorHandle<TSnapshot> & {
  selection?: DocxSelectionPort;
  cancel?: (reason?: string) => Promise<void> | void;
};

/** The view consumes the published G2 wire shape instead of maintaining a
 * second, subtly different open-result declaration. The intersections keep
 * this format lane narrowed to DOCX while retaining contract additions. */
export type DocxOpenSuccess = Extract<OpenOutcome, { outcome: "opened" }>;
export type DocxOpenFailure = Extract<OpenOutcome, { outcome: "failed" }> & {
  format: "docx";
  failure_class: OpenFailureClass;
};
export type DocxOpenOutcome = DocxOpenSuccess | DocxOpenFailure;

export interface DocxOpenPort {
  open(signal?: AbortSignal): Promise<DocxOpenOutcome>;
}

export interface DocxSaveCoordinator {
  getState(): SaveCoordinatorState;
  subscribe(listener: (state: SaveCoordinatorState) => void): () => void;
  save(entryPoint?: "button" | "menu" | "shortcut" | "dialog" | "retry"): Promise<SaveAttemptResult>;
  cancel?(): Promise<void>;
  markDirty?(generation: number): void;
  checkpoint?(): Promise<void>;
}

export interface DocxCapability extends OfficeCapabilityEntry {
  operation: string;
}

export interface DocxEditorProps<TSnapshot = unknown> {
  /** Stable key from the editor slot. Changing it disposes the old session and
   * opens the next file without reloading the application. */
  documentKey: string;
  editor: DocxEditorHandle<TSnapshot>;
  open: DocxOpenPort;
  coordinator: DocxSaveCoordinator;
  /** The host passes its serialize capability row. Missing or mismatched rows
   * fail closed so a forgotten prop can never grant editing accidentally. */
  capability?: DocxCapability;
  title?: string;
  className?: string;
  onOpen?: (outcome: DocxOpenOutcome) => void;
  onSelectionChange?: (selection: DocxSelection | null) => void;
}

export type DocxViewState = "opening" | "ready" | "error";

export interface DocxSnapshot extends StableSnapshot<unknown> {
  value: unknown;
}

export type { OfficeState };
