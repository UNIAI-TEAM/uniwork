import type {
  EditorHandle,
  OfficeCapabilityEntry,
  OfficeState,
  SaveAttemptResult,
  SaveCoordinatorState,
  StableSnapshot,
} from "@uniwork/core/office";
import type { OfficePrintPort } from "../print";
import type { XlsxGridHostPort } from "./xlsx-grid-surface";
import type { XlsxRangeType } from "./selection-mapping";
import type { XlsxDroppedRuleSet } from "./conditional-format/rule-set-drops";
import type {
  XlsxCellState,
  XlsxRecalcCell,
  XlsxRecalcResult,
  XlsxWorkbookSnapshot,
} from "@uniwork/office-engine/xlsx";

/** A selection is a workbook location, rather than a DOM range. The host owns
 * the selection so keyboard, mouse, and desktop hosts share one identity. */
export interface XlsxSelection {
  sheet: string;
  address: string;
  endAddress?: string;
  /** Univer RANGE_TYPE from the live grid (see selection-mapping.ts); absent
   *  for fallback-surface and host-set selections. */
  rangeType?: XlsxRangeType;
}

export interface XlsxSelectionPort {
  getSelection(): XlsxSelection | null;
  setSelection?(selection: XlsxSelection): void;
  subscribe?(listener: (selection: XlsxSelection | null) => void): () => void;
}

export interface XlsxClipboardPort {
  readText?(): Promise<string>;
  writeText?(text: string): Promise<void>;
}

/** The browser-safe G2 operation. The view never receives bytes or a Node
 * binding; the host translates this wire operation to the public adapter. */
export interface XlsxEditPort {
  edit?(ops: readonly unknown[]): Promise<void> | void;
}

export interface XlsxRecalcController {
  run(
    signal: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<XlsxRecalcResult | void>;
  cancel?(): Promise<void> | void;
}

export type XlsxEditorHandle<TSnapshot = XlsxWorkbookSnapshot> = EditorHandle<TSnapshot> &
  XlsxEditPort & {
    selection?: XlsxSelectionPort;
    clipboard?: XlsxClipboardPort;
    recalculate?: XlsxRecalcController;
    /** The host may expose the adapter's browser-safe snapshot for rendering. */
    getWorkbookSnapshot?(): XlsxWorkbookSnapshot | null;
    /** Notify the view when a host-side recovery replaces the live snapshot. */
    subscribeSnapshot?(listener: (snapshot: XlsxWorkbookSnapshot) => void): () => void;
    cancel?: (reason?: string) => Promise<void> | void;
    /** X01 r2: the CF/DV rule sets the last save dropped (named by the engine
     *  refusal xlsx_rule_sets_dropped); empty after a successful save. */
    droppedRuleSets?(): readonly XlsxDroppedRuleSet[];
  };

export interface XlsxOpenSuccess {
  outcome: "opened";
  document_id: string;
  document_model_ref: string;
  warnings?: readonly string[];
  snapshot?: XlsxWorkbookSnapshot;
}

export interface XlsxOpenFailure {
  outcome: "failed";
  document_id: string;
  format: "xlsx";
  failure_class: string;
  message?: string;
  engine_error?: string;
}

export type XlsxOpenOutcome = XlsxOpenSuccess | XlsxOpenFailure;

export interface XlsxOpenPort {
  open(signal?: AbortSignal): Promise<XlsxOpenOutcome>;
}

export interface XlsxSaveCoordinator {
  getState(): SaveCoordinatorState;
  subscribe(listener: (state: SaveCoordinatorState) => void): () => void;
  save(entryPoint?: "button" | "menu" | "shortcut" | "dialog" | "retry"): Promise<SaveAttemptResult>;
  cancel?(): Promise<void>;
  markDirty?(generation: number): void;
  checkpoint?(): Promise<void>;
}

export interface XlsxCapability extends OfficeCapabilityEntry {
  operation: string;
}

export interface XlsxEditorPermissions {
  canEdit?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
}

export interface XlsxEditorProps<TSnapshot = XlsxWorkbookSnapshot> {
  /** Stable key from the editor slot. Changing it disposes the old session. */
  documentKey: string;
  editor: XlsxEditorHandle<TSnapshot>;
  open: XlsxOpenPort;
  coordinator: XlsxSaveCoordinator;
  /** G3-05c: when the host supplies the render model, the editor mounts the
   *  vendored genoffice grid instead of the value snapshot table. */
  rendererHost?: XlsxGridHostPort;
  capability?: XlsxCapability;
  permissions?: XlsxEditorPermissions;
  title?: string;
  /** The shared host supplies the title, status and Save control. */
  embedded?: boolean;
  className?: string;
  onOpen?: (outcome: XlsxOpenOutcome) => void;
  /** Ready is emitted after the grid loads, and error on renderer failure. */
  onViewStateChange?: (state: XlsxViewState) => void;
  onSelectionChange?: (selection: XlsxSelection | null) => void;
  /** Bind all host Save entry points to the active grid's edit preparation. */
  registerSavePreparation?: (prepare: () => Promise<void>) => () => void;
  /** Where a confirmed save lands. Defaults to cloud; the desktop passes local
   *  for a file on disk so the label does not claim a UniWork receipt. */
  saveDestination?: "cloud" | "local";
  /** UNI-952: the host print port. Undefined = the web browser port; null =
   *  this host cannot print (no Print entry is shown). */
  printPort?: OfficePrintPort | null;
}

export type XlsxViewState = "opening" | "ready" | "error";

export interface XlsxSnapshot extends StableSnapshot<XlsxWorkbookSnapshot> {
  value: XlsxWorkbookSnapshot;
}

export type { OfficeState, XlsxCellState, XlsxRecalcCell, XlsxWorkbookSnapshot };
