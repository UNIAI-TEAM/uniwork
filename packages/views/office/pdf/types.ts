import type {
  EditorHandle,
  OfficeCapabilityEntry,
  OfficeState,
  SaveAttemptResult,
  SaveCoordinatorState,
  StableSnapshot,
} from "@uniwork/core/office";
import type { OpenFailureClass, OpenOutcome } from "@uniwork/office-contracts";
import type { PdfCanvasPage, PdfPageRenderService } from "./canvas/types";
import type { PdfSearchHit } from "./find/types";
import type { PdfFormField } from "./forms/types";
import type { PdfNoteThread } from "./notes/types";

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

export type PdfDrawingType = "rect" | "ellipse" | "line" | "arrow";
export type PdfDrawingRect = [number, number, number, number];
export type PdfDrawingGeometry =
  | { rect: { x: number; y: number; width: number; height: number } }
  | { start: { x: number; y: number }; end: { x: number; y: number } }
  | { points: { x: number; y: number }[] };

/** Public browser operations. Images are provider-owned asset references; raw
 * image bytes and codecs never cross into this package. */
export type PdfEditOperation =
  /** target.page is the 1-based displayed position at the time of the operation. */
  | { op: "replace_text"; target: { page: number; objectId: string }; text: string }
  | { op: "replace_image"; target: { page: number; objectId: string }; assetId: string }
  | { op: "add_markup"; target: PdfTextMarkupSelection; type: PdfMarkupType; color: [number, number, number] }
  | { op: "add_drawing"; target: { page: number; geometry: PdfDrawingGeometry }; kind: PdfDrawingType | "ink"; color: [number, number, number]; width: number; fill?: [number, number, number] }
  | { op: "add_note"; target: { page: number; rect: [number, number, number, number]; contents: string; author?: string; replyTo?: { objNum: number; rect: [number, number, number, number]; contents: string } } }
  | { op: "edit_note"; target: { page: number; objNum: number; rect: [number, number, number, number]; contents: string }; contents: string }
  | { op: "resolve_note"; target: { page: number; objNum: number; rect: [number, number, number, number]; contents: string }; resolved: boolean }
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
    /** Host page renderer; with `getCanvasPages` it makes the surface draw real pages. */
    renderer?: PdfPageRenderService;
    getCanvasPages?(): readonly PdfCanvasPage[];
    /** Engine-envelope operations (camelCase) from the panel providers. */
    submitEngineOperations?(operations: readonly unknown[]): Promise<{ skipped: readonly { op: string; reason: string }[] } | void>;
    readFormFields?(): Promise<readonly PdfFormField[]>;
    /** Saved note threads read from the file; absent when the host cannot read them. */
    readSavedNotes?(): Promise<readonly PdfNoteThread[]>;
    searchText?(query: string): Promise<readonly PdfSearchHit[]>;
    /** Fires when the document bytes changed (edit, undo, redo). */
    subscribe?(listener: () => void): () => void;
  };

export type PdfOpenSuccess = Extract<OpenOutcome, { outcome: "opened" }>;
export type PdfOpenFailure = Extract<OpenOutcome, { outcome: "failed" }> & {
  format: "pdf";
  failure_class: OpenFailureClass;
};
export type PdfOpenOutcome = PdfOpenSuccess | PdfOpenFailure;

export interface PdfOpenPort {
  /**
   * Open the document. `password` is supplied only on a retry after an
   * outcome failed with failure_class "password_required" or "wrong_password";
   * the port verifies it in the engine and the caller never stores it. A port
   * that cannot carry a password leaves those failures to the error state
   * instead of retrying.
   */
  open(signal?: AbortSignal, password?: string): Promise<PdfOpenOutcome>;
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
