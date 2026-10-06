// G3-05c (UNI-824) - UniWork-authored controller around the vendored genoffice
// sheets renderer. The vendored modules are Apache-2.0 source from the pin;
// this file is UniWork code: it owns the Univer instance lifecycle, the
// genoffice host-port bridge (window.desktopApi) and the public renderer API
// the shared XlsxEditor mounts. No vendored file is edited here.
import {
  BooleanNumber,
  CommandType,
  ICommandService,
  ThemeService,
  WrapStrategy,
} from "@univerjs/core";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import { UniverSheetsNotePreset } from "@univerjs/preset-sheets-note";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import { UniverSheetsTablePreset, UniverSheetsTableUIPlugin } from "@univerjs/preset-sheets-table";
import type { WorkbookFile, WorkbookRangeResult } from "../../upstream/apps/sheets/src/shared/desktop-api";
import type { IRange, IStyleData } from "@univerjs/core";
import { SheetInterceptorService } from "@univerjs/sheets";
import { canEditRange, canExecuteCommand } from "./command-policy";
import { parseCellText } from "./cell-input";
import { installShiftedNavigation } from "./shifted-navigation";
import { ingestRuleSetMutation, readLiveRuleSet, restoreRuleSetFamily, type XlsxRendererLiveRule, type XlsxRendererRuleSetKind, type XlsxRendererRuleSetRule } from "./rule-set-capture";
import { ruleSetRestoreAllowed } from "./rule-set-policy";
import { installDvRejectDialogTitle, rendererLocaleOptions, sheetHasDataValidation } from "./dv-reject-dialog";
import { loadWorkbookFonts, type XlsxRendererFontMapping } from "./fonts";
import { commandMovesCells, createGridGeometry, type XlsxRendererCellBox, type XlsxRendererCellHit, type XlsxRendererRangeValues } from "./geometry";
import {
  applyColumnDefaultWidth,
  applyOutlineAction,
  createValidatedWriteGate,
  observeValidationVerdicts,
  ingestCellMutation,
  ingestFilterMutation,
  ingestMergeMutation,
  ingestSheetMutation,
  ingestTableMutation,
  ingestStructuralMutation,
  ingestSortMutation,
  sessionTableIdForName,
  ingestNoteMutation,
  hyperlinkEdit,
  intersectMergeRanges,
  isSheetMutation,
  liveSessionSheets,
  seedColumnOutline,
  type AxisRange,
  type RendererCommand,
  type XlsxRendererEdit,
  type XlsxRendererFilterEdit,
} from "./edits";
import { getLang, t } from "./locale";
import { sharedFormulaResolverFor } from "../../upstream/apps/sheets/src/renderer/shared-formula-journal";
import { installAutofitLinePitch } from "../../upstream/apps/sheets/src/renderer/autofit-line-pitch";
import { installAutofitWrapBudget } from "../../upstream/apps/sheets/src/renderer/autofit-wrap-budget";
import { installCellClipAnchorFix } from "../../upstream/apps/sheets/src/renderer/cell-clip-anchor-fix";
import { installCenterContinuousRender } from "../../upstream/apps/sheets/src/renderer/center-continuous";
import { createUniver } from "../../upstream/apps/sheets/src/renderer/create-univer";
import { installHeaderUnhideDebounce } from "../../upstream/apps/sheets/src/renderer/load-perf-patches";
import { createEditJournal, type EditJournal } from "../../upstream/apps/sheets/src/renderer/edit-journal";
import { installFilterRangeOutlineSuppression } from "../../upstream/apps/sheets/src/renderer/filter-range-outline";
import { installFormulaStreamHold } from "../../upstream/apps/sheets/src/renderer/formula-stream-hold";
import { installForceStringMarkGate, installLongTextRender } from "../../upstream/apps/sheets/src/renderer/long-text-render";
import { installMergeBorderFix } from "../../upstream/apps/sheets/src/renderer/merge-border-fix";
import { installNumberAsTextAlertSeverity } from "../../upstream/apps/sheets/src/renderer/number-as-text-alert";
import { applyHostNumfmtLocale, installNumberFormatFix } from "../../upstream/apps/sheets/src/renderer/numfmt-fix";
import { installRichTextBidiFix } from "../../upstream/apps/sheets/src/renderer/rich-text-bidi-fix";
import { installRtlGridMirror } from "../../upstream/apps/sheets/src/renderer/rtl-grid-mirror";
import { installRtlTextDirectionFix } from "../../upstream/apps/sheets/src/renderer/rtl-text-fix";
import { installThickBorderFix } from "../../upstream/apps/sheets/src/renderer/thick-border-fix";
import {
  installFindRevealFix,
  installInjectorResolutionGuard,
  journalRangeSnapshot,
  installWrapMeasureLifecycle,
  loadVisibleRange,
  loadWorkbookSkeleton,
  revealCellBelowFreeze,
  applyAiHyperlink,
  normalizeLinkTarget,
} from "../../upstream/apps/sheets/src/renderer/univer-sync";
import { parseAddress } from "../../upstream/packages/xlsx-gateway/src/domain/cell-address";
import { executeAsOneUndoStep, type XlsxRendererCommandStep } from "./undo-step";
import {
  installJournalSuppressionUndoFilter,
  installLoadAutoHeightGate,
  journalSuppression,
  loadAutoHeightSuppression,
  type LazyWorkbookState,
  type UniverRuntime,
} from "../../upstream/apps/sheets/src/renderer/univer-state";

/** The host surface the vendored loaders call through `window.desktopApi`. */
export interface XlsxRendererHost {
  readRange(input: {
    sessionId: string;
    sheetId: string;
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  }): Promise<WorkbookRangeResult>;
  readFormulas?(input: { sessionId: string; sheetId: string }): Promise<unknown>;
  recalcWorkbook?(input: unknown): Promise<unknown>;
}

export interface XlsxRendererOptions {
  /** Element the Univer canvas mounts into. */
  container: HTMLElement;
  host: XlsxRendererHost;
  dark?: boolean;
  readOnly?: boolean;
  onMessage?: (message: string) => void;
  onDirty?: () => void;
  onEdits?: (edits: XlsxRendererEdit[]) => void;
  onSelectionChange?: (selection: { sheetId: string; range: IRange } | null) => void;
  /** UNI-940 X02: the grid moved under a visual overlay (scroll, zoom,
   *  sheet switch or any executed command); re-read the cell boxes. */
  onViewportChange?: () => void;
}

type DesktopApi = Record<string, unknown>;

/** The cheap active-selection style read the toolbar mirrors control state
 *  from. Alignment numbers are the pinned Univer style values (horizontal
 *  1=left, 2=center, 3=right; vertical 1=top, 2=middle, 3=bottom); rotation is
 *  degrees. A null field means the cell declares no value for it. */
export interface XlsxRendererFormatState {
  readonly fontFamily: string | null;
  readonly fontSize: number | null;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly textColor: string | null;
  readonly fillColor: string | null;
  readonly horizontalAlign: number | null;
  readonly verticalAlign: number | null;
  readonly wrap: boolean;
  readonly textRotation: number | null;
}

function formatStateFromStyle(style: IStyleData | null | undefined): XlsxRendererFormatState {
  return {
    fontFamily: style?.ff ?? null,
    fontSize: typeof style?.fs === "number" ? style.fs : null,
    bold: style?.bl === BooleanNumber.TRUE,
    italic: style?.it === BooleanNumber.TRUE,
    underline: style?.ul?.s === BooleanNumber.TRUE,
    strike: style?.st?.s === BooleanNumber.TRUE,
    textColor: style?.cl?.rgb ?? null,
    fillColor: style?.bg?.rgb ?? null,
    horizontalAlign: typeof style?.ht === "number" ? style.ht : null,
    verticalAlign: typeof style?.vt === "number" ? style.vt : null,
    wrap: style?.tb === WrapStrategy.WRAP,
    textRotation: typeof style?.tr?.a === "number" ? style.tr.a : null,
  };
}

/** One live sheet as the tab strip reads it (order = tab order). */
export interface XlsxRendererSheetInfo {
  readonly id: string;
  readonly name: string;
  readonly hidden: boolean;
}

export interface XlsxRendererHandle {
  /** Install the workbook skeleton and stream the first visible window. */
  loadWorkbook(file: WorkbookFile, options?: { initialSheetId?: string }): Promise<void>;
  /** Stream the current viewport of the active sheet (scroll hook). */
  refreshViewport(): void;
  /** Scroll so the given cell is visible (freeze-aware). */
  revealCell(sheetId: string, row: number, column: number): Promise<void>;
  setCellText(sheetId: string, row: number, column: number, text: string): void;
  /** Commit a pending in-cell edit before the host snapshots an explicit Save. */
  commitEdit(): Promise<void>;
  selectSheet(sheetId: string): void;
  setNumberFormat(pattern: string): void;
  /** Run an allowlisted Univer command against the active selection. Refuses
   *  read-only mounts, a missing workbook/sheet/range, and anything the
   *  command policy cancels (the policy stays the single savability gate).
   *  Returns whether the command actually ran. */
  executeCommand(id: string, params?: unknown): Promise<boolean>;
  /** UNI-953: several commands as ONE undo entry (a rich paste). */
  executeCommandsAsOneStep(steps: readonly XlsxRendererCommandStep[]): Promise<boolean>;
  /** The active range's composed style, or null without an active range.
   *  Read-only mounts still report state; only writes are refused. */
  getActiveFormatState(): XlsxRendererFormatState | null;
  /** The live sheet list in tab order (rename/insert/remove/reorder as they
   *  happen); read-only mounts still report it. */
  getSheets(): readonly XlsxRendererSheetInfo[];
  /** After a save dropped a CF/DV family of a sheet (r3 MA-3): refuse it for
   *  the session and show the rules the file holds (null: as opened).
   *  Refused on a read-only mount or by the rule-set policy. */
  restoreRuleSet(sheetId: string, kind: XlsxRendererRuleSetKind, rules: readonly XlsxRendererRuleSetRule[] | null): boolean;
  /** UNI-953 rule manager: a sheet's live CF / DV rules with their model ids
   *  (null before a workbook loads or for an unknown sheet). */
  readRuleSets(sheetId: string, kind: XlsxRendererRuleSetKind): XlsxRendererLiveRule[] | null;
  setDarkMode(dark: boolean): void;
  undo(): void;
  redo(): void;
  getDirtyGeneration(): number;
  getFontMappings(): readonly XlsxRendererFontMapping[];
  getJournal(): EditJournal;
  /** UNI-940 X02 geometry seam: a cell's box in container pixels on the
   *  active sheet (null for any other sheet), and the cell under a point. */
  getCellBox(sheetId: string, row: number, column: number): XlsxRendererCellBox | null;
  cellAtPoint(sheetId: string, x: number, y: number): XlsxRendererCellHit | null;
  /** Live values of a range on the active sheet (null for another sheet). */
  readRangeValues(sheetId: string, range: IRange): XlsxRendererRangeValues | null;
  dispose(): void;
}

const RENDERER_ROOT_CLASS = "xlsx-surface";
const UNIVER_CONTAINER_CLASS = "xlsx-univer-container";

/** Stamp cell/structural/merge edits with the sheet's live name when it
 *  differs from the file's (a session rename or an added sheet). The views
 *  bridge otherwise resolves the grid id through the host file, which is
 *  stale after a rename and has no entry for an addition; an edit without the
 *  stamp stays byte-identical to the pre-B3 wire. Sheet edits carry their own
 *  names and are never stamped. */
function withLiveSheetNames(state: LazyWorkbookState | null, edits: XlsxRendererEdit[]): XlsxRendererEdit[] {
  if (!state || edits.length === 0) return edits;
  const live = new Map(liveSessionSheets(state).map((sheet) => [sheet.id, sheet.name]));
  const file = new Map(state.file.sheets.map((sheet) => [sheet.id, sheet.name]));
  return edits.map((edit) => {
    if ("sheetOp" in edit) return edit;
    const name = live.get(edit.sheetId);
    if (name === undefined || name === file.get(edit.sheetId)) return edit;
    return { ...edit, sheetName: name };
  });
}

/**
 * A minimal, reversible bridge: the vendored modules read the genoffice host
 * port off `window.desktopApi`, so the controller installs the translation
 * while the renderer is mounted and restores whatever existed before on
 * dispose (the desktop shell owns its own global and must not lose it).
 */
function installDesktopApiBridge(host: XlsxRendererHost): () => void {
  const globalObject = globalThis as unknown as { desktopApi?: unknown };
  const previous = globalObject.desktopApi;
  const api: DesktopApi = {
    readWorkbookRange: (input: { sessionId: string; sheetId: string; range: IRange }) => host.readRange(input),
    readWorkbookFormulas: (input: { sessionId: string; sheetId: string }) => host.readFormulas?.(input) ?? Promise.resolve({ cells: [] }),
    recalcWorkbook: (input: unknown) => host.recalcWorkbook?.(input) ?? Promise.resolve({ cells: [], cached: false }),
    // Visuals are outside this slice's render scope; the vendored callers get
    // a typed empty answer, never a fabricated image.
    readLocalImage: () => Promise.resolve(null),
    fetchImage: () => Promise.resolve(null),
    closeWorkbook: () => Promise.resolve(),
  };
  globalObject.desktopApi = api;
  return () => {
    if (globalObject.desktopApi === api) globalObject.desktopApi = previous;
  };
}

function createLazyState(file: WorkbookFile): LazyWorkbookState {
  const gridCellCount = file.sheets.reduce((sum, sheet) => sum + sheet.rowCount * sheet.columnCount, 0);
  return {
    file,
    generation: Date.now(),
    loadedRanges: new Map(),
    loadingKeys: new Map(),
    retryTimers: new Map(),
    appliedMerges: new Map(),
    appliedRowKeys: new Map(),
    measuredWrapRows: new Map(),
    rowColStyleKeys: new Map(),
    appliedCfSheets: new Set(),
    appliedFilterSheets: new Set(),
    appliedDvSheets: new Set(),
    decorationsPendingSheets: new Set(),
    sheetProtections: new Map(),
    sheetPageBreaks: new Map(),
    sheetFilePageSetups: new Map(),
    sheetProtectedRanges: new Map(),
    uninstalledDefinedNames: new Set(),
    hyperlinkTargets: new Map(),
    frozenStripKeys: new Map(),
    filterOrigins: new Map(),
    restoredFilterSpans: new Map(),
    showFormulaSheets: new Set(file.sheets.filter((sheet) => sheet.showFormulas).map((sheet) => sheet.id)),
    // Small workbooks get live display recalculation; large ones stream cached
    // values (the file's own) and rely on the save-time service recalculation.
    formulaMode: gridCellCount <= 2_000_000,
    editJournal: createEditJournal(),
    flags: { preloadComplete: false, preloadRunning: false },
    closure: { status: "idle", pinned: new Map() },
    formulaText: new Map(),
    cachedFormulaValues: new Map(),
    pivotDefinitions: new Map(),
    hiddenFileRows: new Map(),
    hiddenRowsCoveredThrough: new Map(),
    outline: new Map(),
    recalc: {
      timer: null,
      generation: 0,
      failures: 0,
      engineOverBudget: false,
      formulaCells: new Map(),
      overlay: new Map(),
      follow: new Map(),
      running: false,
      lastRunAt: 0,
    },
  };
}

let rendererSequence = 0;

/**
 * Mount the vendored sheets renderer into `container` and return the UniWork
 * handle. The host bridge stays installed until dispose().
 */
export function createXlsxRenderer(options: XlsxRendererOptions): XlsxRendererHandle {
  const container = options.container;
  container.classList.add(RENDERER_ROOT_CLASS);
  rendererSequence += 1;
  const containerId = container.id || `uniwork-xlsx-univer-${rendererSequence}`;
  container.id = containerId;
  const univerHost = container.ownerDocument.createElement("div");
  univerHost.className = UNIVER_CONTAINER_CLASS;
  univerHost.style.width = "100%";
  univerHost.style.height = "100%";
  container.appendChild(univerHost);
  univerHost.id = `${containerId}-canvas`;

  const restoreDesktopApi = installDesktopApiBridge(options.host);
  const setMessage = (message: string) => options.onMessage?.(message);

  const runtime: UniverRuntime = createUniver({
    darkMode: options.dark ?? false,
    // The app language, with the app's copy for the DV surfaces (X01 vfix-dv).
    ...rendererLocaleOptions(),
    presets: [
      UniverSheetsCorePreset({
        container: univerHost.id,
        header: false,
        toolbar: false,
        contextMenu: false,
        formulaBar: false,
        footer: false,
        statusBarStatistic: false,
        sheets: { isRowStylePrecedeColumnStyle: true, disableForceStringAlert: true, disableForceStringMark: true },
        formula: { functionScreenTips: false },
      }),
      UniverSheetsDrawingPreset(),
      UniverSheetsConditionalFormattingPreset(),
      UniverSheetsFilterPreset(),
      UniverSheetsDataValidationPreset(),
      UniverSheetsNotePreset(),
      UniverSheetsFindReplacePreset(),
      UniverSheetsSortPreset(),
      UniverSheetsTablePreset(),
      { plugins: [[UniverSheetsTableUIPlugin, { hideAnchor: true }]] },
    ],
  });

  // Load-time render patches (the vendored fixes the pin applies to stock
  // Univer): order mirrors the pin's App wiring where it matters.
  installFilterRangeOutlineSuppression(runtime);
  installInjectorResolutionGuard(runtime);
  let findRevealDispose: (() => void) | undefined;
  let numberFormatDispose: { dispose(): void } | undefined;
  let dvRejectDialogDispose: { dispose(): void } | undefined;
  let validatedWriteVerdictDispose: { dispose(): void } | undefined;
  const wrapMeasureDisposable = installWrapMeasureLifecycle(runtime);
  installJournalSuppressionUndoFilter();
  installLoadAutoHeightGate();
  installCellClipAnchorFix();
  installMergeBorderFix();
  installThickBorderFix();
  installRtlTextDirectionFix();
  installRtlGridMirror();
  installRichTextBidiFix();
  installCenterContinuousRender();
  installLongTextRender();
  installAutofitWrapBudget();
  installAutofitLinePitch();
  installHeaderUnhideDebounce();
  installNumberAsTextAlertSeverity();
  installFormulaStreamHold(runtime);

  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: null };
  let dirtyGeneration = 0;
  // A refused data-validation commit is held back until its verdict and then
  // journals nothing (edits.ts). Accepted edits are emitted from here.
  const validatedWrites = createValidatedWriteGate((held) => {
    dirtyGeneration += 1;
    options.onEdits?.(withLiveSheetNames(lazyWorkbookRef.current, held));
    options.onDirty?.();
  });
  let fontMappings: XlsxRendererFontMapping[] = [];
  let disposed = false;
  let commitInProgress = false;
  let commitDenied = false;
  let loadingWorkbook = false;
  let lastSelectionState: LazyWorkbookState | null = null;
  let lastSelectionKey: string | undefined;
  let lastSelection: { state: LazyWorkbookState; sheetId: string; range: IRange } | null = null;

  const commitEdit = async () => {
    if (options.readOnly) return;
    const workbook = runtime.univerAPI.getActiveWorkbook();
    if (disposed || !workbook || commitInProgress) throw new Error("xlsx_cell_edit_commit_failed");
    commitInProgress = true;
    commitDenied = false;
    try {
      const committed = await workbook.endEditingAsync(true);
      if (disposed || !committed || workbook.isCellEditing() || commitDenied) throw new Error("xlsx_cell_edit_commit_failed");
    } finally { commitInProgress = false; }
  };
  const removeShiftedNavigation = installShiftedNavigation(container, runtime, {
    getState: () => loadingWorkbook ? null : lazyWorkbookRef.current,
    getLastSelection: () => {
      const state = lazyWorkbookRef.current;
      return lastSelection && lastSelection.state === state
        ? { sheetId: lastSelection.sheetId, range: { ...lastSelection.range } }
        : null;
    },
    readOnly: options.readOnly ?? false, commitEdit,
    onFailure: () => setMessage("xlsx_cell_edit_commit_failed"),
  });

  const themeService = runtime.univer.__getInjector().get(ThemeService);
  const geometry = createGridGeometry(runtime, container);
  const notifyViewport = () => options.onViewportChange?.();

  const refreshViewport = () => {
    const state = lazyWorkbookRef.current;
    const active = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet();
    if (!state || !active) return;
    void loadVisibleRange(runtime, lazyWorkbookRef, active, setMessage).catch(() => undefined);
  };
  const notifySelection = () => {
    if (disposed) return;
    const workbook = runtime.univerAPI.getActiveWorkbook();
    const sheet = workbook?.getActiveSheet();
    const range = workbook?.getActiveRange()?.getRange();
    const selection = sheet && range ? { sheetId: sheet.getSheetId(), range: { ...range } } : null;
    const key = selection ? JSON.stringify([selection.sheetId, selection.range.startRow, selection.range.endRow,
      selection.range.startColumn, selection.range.endColumn, selection.range.rangeType]) : "null";
    const state = lazyWorkbookRef.current;
    if (selection && state) lastSelection = { state, sheetId: selection.sheetId, range: { ...selection.range } };
    else if (!selection) lastSelection = null;
    if (lastSelectionState === state && lastSelectionKey === key) return;
    lastSelectionState = state;
    lastSelectionKey = key;
    options.onSelectionChange?.(selection);
  };

  // Viewport streaming: scroll and sheet switches refetch the visible window.
  const disposables: Array<{ dispose(): void }> = [];

  // UniWork outline commands (B1): the pinned Univer has no outline model and
  // journals no levels, so these two commands record the level change
  // straight into the renderer's structural journal (one op per contiguous
  // run) and emit it on the same edit channel as cell edits. They carry no
  // undo entry — there is no Univer state to undo (genoffice parity). The
  // column default-width reset rides the same route: the pinned build's
  // `set-col-is-auto-width` command emits no mutation, so the reset journals
  // a null set-col-size op itself.
  const commandService = runtime.univer.__getInjector().get(ICommandService);
  const emitStructuralEdits = (edits: XlsxRendererEdit[]): boolean => {
    if (edits.length === 0) return false;
    dirtyGeneration += 1;
    // B6/F2: hyperlink + outline edits emitted outside the CommandExecuted
    // batch must carry the live sheet name too, exactly like the batch below.
    options.onEdits?.(withLiveSheetNames(lazyWorkbookRef.current, edits));
    options.onDirty?.();
    return true;
  };
  const runOutline = (axis: "rows" | "cols", params: unknown): boolean => {
    const p = params as { subUnitId?: string; start?: number; end?: number; action?: "group" | "ungroup" | "clear" } | undefined;
    if (journalSuppression.active || !p || typeof p.start !== "number" || typeof p.end !== "number") return false;
    if (p.action !== "group" && p.action !== "ungroup" && p.action !== "clear") return false;
    const sheetId = p.subUnitId ?? runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()?.getSheetId();
    if (!sheetId) return false;
    return emitStructuralEdits(applyOutlineAction(lazyWorkbookRef.current, sheetId, axis, p.start, p.end, p.action));
  };
  const runColumnDefaultWidth = (params: unknown): boolean => {
    const p = params as { subUnitId?: string; start?: number; end?: number } | undefined;
    if (journalSuppression.active || !p || typeof p.start !== "number" || typeof p.end !== "number") return false;
    const sheetId = p.subUnitId ?? runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()?.getSheetId();
    if (!sheetId) return false;
    return emitStructuralEdits(applyColumnDefaultWidth(lazyWorkbookRef.current, sheetId, p.start, p.end));
  };
  for (const [id, axis] of [
    ["uniwork.command.set-rows-outline", "rows"],
    ["uniwork.command.set-cols-outline", "cols"],
  ] as const) {
    disposables.push(commandService.registerCommand({
      id,
      type: CommandType.COMMAND,
      handler: (_accessor, params) => runOutline(axis, params),
    }));
  }
  disposables.push(commandService.registerCommand({
    id: "uniwork.command.set-cols-default-width",
    type: CommandType.COMMAND,
    handler: (_accessor, params) => runColumnDefaultWidth(params),
  }));
  // Hyperlinks (B6): the pinned Univer 0.25.1 has no spreadsheet hyperlink
  // command, so UniWork registers one. It mirrors the vendored applyAiHyperlink
  // (journal + link styling) and emits the per-cell edit so the host persists
  // it. params: { subUnitId?, address, target } (target null removes the link).
  const runSetHyperlink = (params: unknown): boolean => {
    const p = params as { subUnitId?: string; address?: string; target?: string | null } | undefined;
    const state = lazyWorkbookRef.current;
    if (journalSuppression.active || !state || !p || typeof p.address !== "string") return false;
    const sheetId = p.subUnitId ?? runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()?.getSheetId();
    const worksheet = sheetId ? runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(sheetId) : undefined;
    if (!sheetId || !worksheet) return false;
    let target: string | null;
    if (p.target === null || p.target === undefined) {
      target = null;
    } else {
      target = normalizeLinkTarget(p.target);
      if (target === null) {
        setMessage(t("appHyperlinkTargetInvalid"));
        return false;
      }
    }
    let row: number;
    let column: number;
    try {
      ({ row, column } = parseAddress(p.address));
    } catch {
      return false;
    }
    applyAiHyperlink(state, worksheet, { op: "set_hyperlink", sheetId, address: p.address, target });
    return emitStructuralEdits([hyperlinkEdit(state, sheetId, row, column, target)]);
  };
  disposables.push(commandService.registerCommand({
    id: "uniwork.command.set-hyperlink",
    type: CommandType.COMMAND,
    handler: (_accessor, params) => runSetHyperlink(params),
  }));
  // Merge capture (B2): `sheet.mutation.remove-worksheet-merge` carries the
  // user's selection ranges, not the merges it removes — the mutation filters
  // the live merge list by intersection. Snapshot the pre-mutation merge list
  // here, the last moment it is intact, and hand the intersect to the edit
  // ingest at CommandExecuted time, keyed by the params object both events
  // share. Add mutations need no snapshot: their `ranges` are already the
  // exact rectangles.
  const pendingMergeRemovals = new WeakMap<object, AxisRange[]>();
  const rememberMergeRemoval = (event: RendererCommand): void => {
    if (event.id !== "sheet.mutation.remove-worksheet-merge" ||
        typeof event.params !== "object" || event.params === null) return;
    const params = event.params as { subUnitId?: string; ranges?: AxisRange[] };
    if (!Array.isArray(params.ranges) || params.ranges.length === 0) return;
    const worksheet = params.subUnitId
      ? runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(params.subUnitId)
      : undefined;
    const merges = worksheet?.getSheet().getMergeData();
    if (!Array.isArray(merges)) return;
    pendingMergeRemovals.set(event.params, intersectMergeRanges(merges, params.ranges));
  };
  // Sheet ops (B3): a copy command dispatches `sheet.mutation.insert-sheet`
  // with a freshly generated id, indistinguishable from a plain add by the
  // mutation params alone. The copy source is snapshotted at the command (its
  // live name included) and consumed by the next insert mutation; a plain
  // insert-sheet command clears any stale marker (a refused copy never
  // inserts).
  let pendingSheetCopy: { sourceSheetId: string; sourceName: string } | null = null;
  const rememberSheetCommand = (event: RendererCommand): void => {
    if (event.id === "sheet.command.insert-sheet") {
      pendingSheetCopy = null;
      return;
    }
    if (event.id !== "sheet.command.copy-sheet") return;
    const params = event.params as { subUnitId?: string } | undefined;
    const state = lazyWorkbookRef.current;
    if (!state || !params?.subUnitId) return;
    const source = liveSessionSheets(state).find((sheet) => sheet.id === params.subUnitId);
    if (source) pendingSheetCopy = { sourceSheetId: source.id, sourceName: source.name };
  };
  disposables.push(runtime.univerAPI.addEvent(runtime.univerAPI.Event.BeforeCommandExecute, (event) => {
    if (journalSuppression.active) return;
    if (!canExecuteCommand(event, lazyWorkbookRef.current, options.readOnly ?? false)) {
      if (commitInProgress) commitDenied = true;
      // F10: a refused copy never inserts, so a marker left by an earlier
      // copy must not survive to mislabel a later unrelated insert.
      if (event.id === "sheet.command.copy-sheet") pendingSheetCopy = null;
      event.cancel = true;
      return;
    }
    rememberMergeRemoval(event);
    rememberSheetCommand(event);
    // The editor commit is the only set-range-values carrying a redo/undo id;
    // it validates after it writes, so its edits wait for the verdict.
    const write = event.id === "sheet.command.set-range-values"
      ? event.params as { unitId?: string; subUnitId?: string; redoUndoId?: unknown } | undefined
      : undefined;
    if (write && typeof write.redoUndoId === "string" && write.unitId && write.subUnitId &&
        sheetHasDataValidation(runtime, write.unitId, write.subUnitId)) {
      validatedWrites.begin(lazyWorkbookRef.current, write.subUnitId);
    }
  }));
  disposables.push(runtime.univerAPI.addEvent(runtime.univerAPI.Event.BeforeSheetEditStart, (event) => {
    if (options.readOnly || !canEditRange(lazyWorkbookRef.current, event.worksheet.getSheetId(), {
      startRow: event.row, endRow: event.row, startColumn: event.column, endColumn: event.column,
    })) {
      event.cancel = true;
      if (!options.readOnly) setMessage(t("appAreaStreaming"));
    }
  }));
  // Rich clipboard payloads can include merges, dimensions and drawings.
  // Refuse them before any cell is written; plain text paste remains supported.
  disposables.push(runtime.univerAPI.addEvent(runtime.univerAPI.Event.BeforeClipboardPaste, (event) => {
    if (options.readOnly || event.html) event.cancel = true;
  }));
  disposables.push(runtime.univerAPI.addEvent(runtime.univerAPI.Event.Scroll, () => { refreshViewport(); notifyViewport(); }));
  disposables.push(runtime.univerAPI.addEvent(runtime.univerAPI.Event.CommandExecuted, (event) => {
    if (commandMovesCells(event?.id)) notifyViewport();
  }));
  disposables.push(
    runtime.univerAPI.addEvent(runtime.univerAPI.Event.ActiveSheetChanged, () =>
      window.setTimeout(() => { refreshViewport(); notifySelection(); notifyViewport(); }, 0),
    ),
  );
  disposables.push(
    runtime.univerAPI.addEvent(runtime.univerAPI.Event.SelectionChanged, notifySelection),
  );
  disposables.push(
    runtime.univerAPI.addEvent(runtime.univerAPI.Event.CommandExecuted, (event) => {
      // Pinned sheets-ui installs SelectionChanged only at Steady. Pointer
      // selections already change the model before then; publish after the
      // exact view operation completes, using its authoritative active range.
      if (event.id === "sheet.operation.set-selections") {
        const state = lazyWorkbookRef.current;
        queueMicrotask(() => { if (lazyWorkbookRef.current === state) notifySelection(); });
      }
      const sheetId = (event.params as { subUnitId?: string } | undefined)?.subUnitId;
      const workbook = runtime.univerAPI.getActiveWorkbook();
      const sheet = sheetId ? workbook?.getSheetBySheetId(sheetId) : undefined;
      const edits = validatedWrites.capture(ingestCellMutation(
        // The rollback of a refused commit is not an edit either.
        lazyWorkbookRef.current, event, journalSuppression.active || (sheetId !== undefined && validatedWrites.isRollback(sheetId)),
        sheetId ? sharedFormulaResolverFor(runtime, sheetId) : undefined,
        (row, column) => {
          const style = workbook?.getWorkbook().getStyles().getStyleByCell(sheet?.getSheet().getCellRaw(row, column));
          return style ? { ...style } : undefined;
        },
      ));
      // Row/column structure rides the same channel: insert/remove, sizes,
      // hidden flags and auto-height resets journal here (outline levels are
      // recorded by the two commands above, outside Univer's mutation set).
      const structuralEdits = ingestStructuralMutation(lazyWorkbookRef.current, event, journalSuppression.active);
      // Merges ride it too; a remove mutation's removed rectangles were
      // snapshot before the mutation ran (the params key both events share).
      const mergeRanges = typeof event.params === "object" && event.params !== null
        ? pendingMergeRemovals.get(event.params)
        : undefined;
      if (typeof event.params === "object" && event.params !== null) pendingMergeRemovals.delete(event.params);
      const mergeEdits = ingestMergeMutation(lazyWorkbookRef.current, event, journalSuppression.active, mergeRanges);
      // Sheet ops (B3) ride the same channel; the pending copy marker is
      // consumed by the NEXT sheet mutation — the insert mutation a copy
      // command dispatches. The copy command's own CommandExecuted is not a
      // mutation, so the marker survives it; any other sheet mutation clears
      // a marker that never found its insert (a refused copy).
      const sheetEdits = ingestSheetMutation(
        lazyWorkbookRef.current, event, journalSuppression.active,
        pendingSheetCopy === null ? {} : { copy: pendingSheetCopy },
      );
      if (isSheetMutation(event.id)) pendingSheetCopy = null;
      // Filters (B4) ride it too: every filter mutation snapshots the live
      // model of its sheet as a whole-sheet declarative state. A snapshot
      // carrying color criteria cannot be written to OOXML; the refusal is
      // surfaced and no edit is emitted (the file keeps its previous filter
      // state) instead of silently dropping criteria.
      let filterEdits: XlsxRendererFilterEdit[] = [];
      try {
        filterEdits = ingestFilterMutation(
          lazyWorkbookRef.current, event,
          (sheetId) => workbook?.getSheetBySheetId(sheetId) ?? null,
          journalSuppression.active,
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
      // Tables (B9): add/delete mutations journal a session table add or
      // cancel it by name.
      const tableEdits = ingestTableMutation(lazyWorkbookRef.current, event, journalSuppression.active);
      // Notes (B6) ride it too: every note mutation snapshots the live note set
      // of its sheet as a whole-sheet declarative state.
      const noteEdits = ingestNoteMutation(
        lazyWorkbookRef.current, event,
        (sheetId) => workbook?.getSheetBySheetId(sheetId) ?? null,
        journalSuppression.active,
      );
      // Sorts (A7): the pinned sort reorders whole rows via
      // sheet.mutation.reorder-range; the vendored journalRangeSnapshot journals
      // every cell of the sorted range, and this ingest surfaces the changed
      // cells on the edit channel so a save persists the new row order.
      const sortEdits = ingestSortMutation(
        lazyWorkbookRef.current, event,
        (state, sheetId, range, order) => journalRangeSnapshot(runtime, state, sheetId, range, order),
        journalSuppression.active,
      );
      // Conditional formatting + data validation (X01): every rule mutation
      // snapshots its sheet's live rule model as a whole-sheet state.
      const ruleSetEdits = ingestRuleSetMutation(
        lazyWorkbookRef.current, event,
        (sheetId) => workbook?.getSheetBySheetId(sheetId) ?? null,
        journalSuppression.active,
      );
      if (edits.length === 0 && structuralEdits.length === 0 && mergeEdits.length === 0 && sheetEdits.length === 0 && filterEdits.length === 0 && tableEdits.length === 0 && noteEdits.length === 0 && sortEdits.length === 0 && ruleSetEdits.length === 0) return;
      dirtyGeneration += 1;
      options.onEdits?.(withLiveSheetNames(lazyWorkbookRef.current, [...edits, ...structuralEdits, ...mergeEdits, ...sheetEdits, ...filterEdits, ...tableEdits, ...noteEdits, ...sortEdits, ...ruleSetEdits]));
      options.onDirty?.();
    }),
  );

  return {
    async loadWorkbook(file, loadOptions) {
      loadingWorkbook = true;
      fontMappings = await loadWorkbookFonts(file, container.ownerDocument);
      if (disposed) return;
      container.setAttribute("data-xlsx-font-mappings", JSON.stringify(fontMappings));
      journalSuppression.active = true;
      loadAutoHeightSuppression.active = true;
      try {
        loadWorkbookSkeleton(runtime, file);
        // Sheet services are registered when the first workbook unit starts.
        // Resolving them during renderer construction leaves the grid unmounted.
        installForceStringMarkGate(runtime.univer.__getInjector().get(SheetInterceptorService));
        findRevealDispose ??= installFindRevealFix(runtime);
        numberFormatDispose ??= installNumberFormatFix(runtime, () => lazyWorkbookRef.current?.file.date1904 ?? false);
        // Separators follow the editor language (vi: 1.250.000.000); Univer keeps "en" otherwise.
        applyHostNumfmtLocale(runtime, getLang() === "vi" ? "vi" : "en");
        dvRejectDialogDispose ??= installDvRejectDialogTitle(runtime, container.ownerDocument, RENDERER_ROOT_CLASS);
        validatedWriteVerdictDispose ??= observeValidationVerdicts(runtime.univer.__getInjector().get(SheetInterceptorService), validatedWrites);
      } finally {
        loadAutoHeightSuppression.active = false;
        journalSuppression.active = false;
      }
      const state = createLazyState(file);
      lazyWorkbookRef.current = state;
      // Column outline metadata rides the sheet metadata (not a streamed
      // chunk), so seed it now, before any session group edit can own an entry.
      seedColumnOutline(state);
      dirtyGeneration = 0;
      const workbook = runtime.univerAPI.getActiveWorkbook();
      // Native workbook permissions also block the vendored viewport loader's
      // setValues commands. Read-only is enforced at the command/edit gates,
      // keeping trusted suppressed loading possible on every scroll.
      const preferred = loadOptions?.initialSheetId ? workbook?.getSheetBySheetId(loadOptions.initialSheetId) : null;
      const active = preferred ?? workbook?.getActiveSheet();
      if (active) {
        workbook?.setActiveSheet(active);
        await loadVisibleRange(runtime, lazyWorkbookRef, active, setMessage);
        if (!workbook?.getActiveRange()) workbook?.setActiveRange(active.getRange(0, 0));
        notifySelection();
      }
      loadingWorkbook = false;
    },
    refreshViewport,
    async revealCell(sheetId, row, column) {
      const worksheet = runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(sheetId);
      if (!worksheet) return;
      runtime.univerAPI.getActiveWorkbook()?.setActiveSheet(worksheet);
      await revealCellBelowFreeze(worksheet, row, column);
    },
    setCellText(sheetId, row, column, text) {
      if (options.readOnly || !canEditRange(lazyWorkbookRef.current, sheetId, {
        startRow: row, endRow: row, startColumn: column, endColumn: column,
      })) return;
      runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(sheetId)?.getRange(row, column).setValue(parseCellText(text));
    },
    commitEdit,
    selectSheet(sheetId) {
      const workbook = runtime.univerAPI.getActiveWorkbook();
      const sheet = workbook?.getSheetBySheetId(sheetId);
      if (sheet) {
        workbook?.setActiveSheet(sheet);
        refreshViewport();
        notifySelection();
      }
    },
    setNumberFormat(pattern) {
      const workbook = runtime.univerAPI.getActiveWorkbook();
      const sheetId = workbook?.getActiveSheet()?.getSheetId();
      const range = workbook?.getActiveRange();
      if (options.readOnly || !sheetId || !range || !pattern || pattern.length > 255 ||
        !canEditRange(lazyWorkbookRef.current, sheetId, range.getRange())) return;
      range.setNumberFormat(pattern);
    },
    async executeCommand(id, params) {
      if (options.readOnly) return false;
      const workbook = runtime.univerAPI.getActiveWorkbook();
      const sheet = workbook?.getActiveSheet();
      const range = workbook?.getActiveRange();
      if (!workbook || !sheet || !range) return false;
      // Toolbar commands address the active render, but the toolbar port only
      // carries a group's own params; fill the unit/sheet ids when a command
      // omits them (explicit params win) so `sheet.operation.set-selections`
      // and the header size commands reach the active unit instead of a
      // no-op. The async command service still runs the
      // BeforeCommandExecute gate, so `canExecuteCommand` decides savability;
      // a cancelled command comes back as false and never touches the model.
      // The pinned handlers for the structural / merge / sort families are
      // `async`, so the port must go through the promise-returning
      // `executeCommand` (the sync variant throws on a promise result).
      const base = params && typeof params === "object" ? params as Record<string, unknown> : {};
      // The toolbar's Remove control carries a name; the pinned delete command
      // takes {tableId}. Resolve the id for a session add (a file-native table
      // stays view-only) so the control reaches the command instead of no-op.
      const sessionTableId = id === "sheet.command.delete-table" && typeof base.name === "string" && typeof base.tableId !== "string"
        ? sessionTableIdForName(sheet.getSheetId(), base.name)
        : undefined;
      const resolved = sessionTableId === undefined ? {} : { tableId: sessionTableId };
      const commandParams = { unitId: workbook.getId(), subUnitId: sheet.getSheetId(), ...base, ...resolved };
      return (await runtime.univerAPI.executeCommand(id, commandParams)) === true;
    },
    executeCommandsAsOneStep(steps) {
      const unitId = runtime.univerAPI.getActiveWorkbook()?.getId();
      if (options.readOnly || !unitId) return Promise.resolve(false);
      return executeAsOneUndoStep(runtime.univer.__getInjector(), unitId, steps, (step) => this.executeCommand(step.id, step.params));
    },
    getActiveFormatState() {
      const range = runtime.univerAPI.getActiveWorkbook()?.getActiveRange();
      return range ? formatStateFromStyle(range.getCellStyleData()) : null;
    },
    getSheets() {
      const sheets = runtime.univerAPI.getActiveWorkbook()?.getSheets() ?? [];
      return sheets.map((sheet) => ({
        id: sheet.getSheetId(),
        name: sheet.getSheetName(),
        hidden: sheet.isSheetHidden() === true,
      }));
    },
    restoreRuleSet(sheetId, kind, rules) {
      const state = lazyWorkbookRef.current;
      if (options.readOnly || !state || !ruleSetRestoreAllowed(state, sheetId, kind, rules)) return false;
      const worksheet = runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(sheetId);
      if (!worksheet) return false;
      journalSuppression.active = true;
      try {
        restoreRuleSetFamily(state, sheetId, kind, rules, {
          worksheet,
          execute: (id, params) => { runtime.univerAPI.syncExecuteCommand(id, params); },
        });
      } finally {
        journalSuppression.active = false;
      }
      return true;
    },
    readRuleSets(sheetId, kind) {
      const state = lazyWorkbookRef.current;
      if (!state || (kind !== "conditionalFormats" && kind !== "dataValidations")) return null;
      const worksheet = runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(sheetId);
      return worksheet ? readLiveRuleSet(worksheet, kind) : null;
    },
    setDarkMode: (dark) => themeService.setDarkMode(dark),
    undo() {
      if (!options.readOnly) void runtime.univerAPI.undo();
    },
    redo() {
      if (!options.readOnly) void runtime.univerAPI.redo();
    },
    getDirtyGeneration: () => dirtyGeneration,
    getFontMappings: () => fontMappings.map((mapping) => ({ ...mapping })),
    getJournal: () => {
      const state = lazyWorkbookRef.current;
      if (!state) throw new Error("xlsx renderer has no workbook loaded");
      return state.editJournal;
    },
    getCellBox: geometry.getCellBox,
    cellAtPoint: geometry.cellAtPoint,
    readRangeValues: geometry.readRangeValues,
    dispose() {
      disposed = true;
      removeShiftedNavigation();
      for (const disposable of disposables) disposable.dispose();
      findRevealDispose?.();
      numberFormatDispose?.dispose();
      dvRejectDialogDispose?.dispose();
      validatedWriteVerdictDispose?.dispose();
      wrapMeasureDisposable?.dispose();
      lazyWorkbookRef.current = null;
      try {
        runtime.univer.dispose();
      } catch {
        /* a disposed injector must not throw during teardown */
      }
      univerHost.remove();
      container.classList.remove(RENDERER_ROOT_CLASS);
      container.removeAttribute("data-xlsx-font-mappings");
      restoreDesktopApi();
    },
  };
}

export { BooleanNumber };
