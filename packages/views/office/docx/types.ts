import type { ReactNode } from "react";
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

/** The block style at the caret — toolbar.tsx reads this instead of reaching
 * into TipTap/ProseMirror directly, same reason DocxSelection exists. */
export interface DocxFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** null = the current block is not a heading. */
  headingLevel: number | null;
  /** null = the current block is not a list item. */
  listKind: "bullet" | "ordered" | null;
}

export interface DocxFormatCommands {
  getState(): DocxFormatState;
  subscribe(listener: (state: DocxFormatState) => void): () => void;
  toggleBold(): void;
  toggleItalic(): void;
  toggleUnderline(): void;
  /** null sets the current block back to a plain paragraph. */
  setHeading(level: number | null): void;
  toggleList(kind: "bullet" | "ordered"): void;
}

/** The view consumes the G3-01 EditorHandle and the optional controls exposed
 * by a DOCX adapter. No engine or byte transport is reachable from JSX. */
export type DocxEditorHandle<TSnapshot = unknown> = EditorHandle<TSnapshot> & {
  selection?: DocxSelectionPort;
  cancel?: (reason?: string) => Promise<void> | void;
  /** A concrete handle that owns a real editing surface (the TipTap-backed
   * implementation in use-docx-tiptap-handle.ts) renders it here instead of
   * the view reaching into engine/DOM internals. Absent in shell-level tests
   * that stub the handle, which keeps rendering the host-shell placeholder. */
  renderSurface?: () => ReactNode;
  commands?: DocxFormatCommands;
  subscribeDirty?: (listener: (generation: number) => void) => () => void;
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
  /** A host that owns the session disposes it when its adapter is released. */
  manageSession?: boolean;
  /** Hide duplicate title/status/Save when the surrounding host provides them. */
  showDocumentControls?: boolean;
  onOpen?: (outcome: DocxOpenOutcome) => void;
  onSelectionChange?: (selection: DocxSelection | null) => void;
}

export type DocxViewState = "opening" | "ready" | "error";

export interface DocxSnapshot extends StableSnapshot<unknown> {
  value: unknown;
}

export type { OfficeState };
