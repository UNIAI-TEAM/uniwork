import type {
  EditorHandle,
  OfficeCapabilityEntry,
  OfficeState,
  SaveAttemptResult,
  SaveCoordinatorState,
  StableSnapshot,
} from "@uniwork/core/office";
import type { OpenFailureClass, OpenOutcome } from "@uniwork/office-contracts";

/** A selection is an adapter identity, never a DOM range or a decoded PDF object. */
export interface PdfSelection {
  /** 1-based displayed page position; the host bridge maps it to the original engine index. */
  page: number;
  objectId: string | null;
  kind: "text" | "image" | "page";
}

export interface PdfSelectionPort {
  getSelection(): PdfSelection | null;
  setSelection?(selection: PdfSelection | null): void;
  subscribe?(listener: (selection: PdfSelection | null) => void): () => void;
}

export interface PdfPage {
  pageNumber: number;
  rotation: number;
  /** A host-owned preview URL. The view never decodes image bytes. */
  previewUrl?: string;
}

export interface PdfSnapshot {
  pages: readonly PdfPage[];
  pageCount: number;
}

export interface PdfFontReport {
  missing: readonly string[];
  embedded: readonly string[];
}

export type PdfMarkupType = "highlight" | "underline" | "strikeout";

export interface PdfTextMarkupSelection {
  page: number;
  /** PDF user-space quads: [x1,yTop,x2,yTop,x1,yBottom,x2,yBottom]. */
  quads: readonly (readonly number[])[];
}

/** Public browser operations. Images are provider-owned asset references; raw
 * image bytes and codecs never cross into this package. */
export type PdfEditOperation =
  /** target.page is the 1-based displayed position at the time of the operation. */
  | { op: "replace_text"; target: { page: number; objectId: string }; text: string }
  | { op: "replace_image"; target: { page: number; objectId: string }; assetId: string }
  | { op: "add_markup"; target: PdfTextMarkupSelection; type: PdfMarkupType; color: [number, number, number] }
  | { op: "insert_page"; target: { index: number } }
  | { op: "delete_page"; target: { page: number } }
  | { op: "rotate_page"; target: { page: number }; degrees: 90 | 180 | 270 }
  | { op: "reorder_page"; target: { page: number }; index: number }
  | { op: "extract_page"; target: { page: number } }
  | { op: "merge_pages"; target: { pages: readonly number[] } };

export interface PdfEditPort {
  edit?(operations: readonly PdfEditOperation[]): Promise<void> | void;
}

/** The view consumes the G3-01 handle and the browser-safe G2 adapter surface. */
export type PdfEditorHandle<TSnapshot = PdfSnapshot> = EditorHandle<TSnapshot> &
  PdfEditPort & {
    selection?: PdfSelectionPort;
    getPdfSnapshot?(): PdfSnapshot | null;
    getFontReport?(): PdfFontReport | null;
    cancel?: (reason?: string) => Promise<void> | void;
  };

export type PdfOpenSuccess = Extract<OpenOutcome, { outcome: "opened" }>;
export type PdfOpenFailure = Extract<OpenOutcome, { outcome: "failed" }> & {
  format: "pdf";
  failure_class: OpenFailureClass;
};
export type PdfOpenOutcome = PdfOpenSuccess | PdfOpenFailure;

export interface PdfOpenPort {
  open(signal?: AbortSignal): Promise<PdfOpenOutcome>;
}

export interface PdfSaveCoordinator {
  getState(): SaveCoordinatorState;
  subscribe(listener: (state: SaveCoordinatorState) => void): () => void;
  save(entryPoint?: "button" | "menu" | "shortcut" | "dialog" | "retry"): Promise<SaveAttemptResult>;
  cancel?(): Promise<void>;
  markDirty?(generation: number): void;
  checkpoint?(): Promise<void>;
}

export interface PdfCapability extends OfficeCapabilityEntry {
  operation: string;
}

export interface PdfEditorProps<TSnapshot = PdfSnapshot> {
  /** Changing this key disposes the old session and opens the next file. */
  documentKey: string;
  editor: PdfEditorHandle<TSnapshot>;
  open: PdfOpenPort;
  coordinator: PdfSaveCoordinator;
  capability?: PdfCapability;
  title?: string;
  className?: string;
  onOpen?: (outcome: PdfOpenOutcome) => void;
  onSelectionChange?: (selection: PdfSelection | null) => void;
}

export type PdfViewState = "opening" | "ready" | "error";

export interface PdfStableSnapshot extends StableSnapshot<PdfSnapshot> {
  value: PdfSnapshot;
}

export type { OfficeState };
