// G3-05c (UNI-824) - UniWork-authored controller around the vendored genoffice
// sheets renderer. The vendored modules are Apache-2.0 source from the pin;
// this file is UniWork code: it owns the Univer instance lifecycle, the
// genoffice host-port bridge (window.desktopApi) and the public renderer API
// the shared XlsxEditor mounts. No vendored file is edited here.
import {
  BooleanNumber,
  LocaleType,
  ThemeService,
  mergeLocales,
} from "@univerjs/core";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import UniverPresetSheetsConditionalFormattingEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import UniverPresetSheetsDataValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import UniverPresetSheetsFilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import UniverPresetSheetsFindReplaceEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import { UniverSheetsNotePreset } from "@univerjs/preset-sheets-note";
import UniverPresetSheetsNoteEnUS from "@univerjs/preset-sheets-note/locales/en-US";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import UniverPresetSheetsSortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import { UniverSheetsTablePreset, UniverSheetsTableUIPlugin } from "@univerjs/preset-sheets-table";
import UniverPresetSheetsTableEnUS from "@univerjs/preset-sheets-table/locales/en-US";
import type { WorkbookFile, WorkbookRangeResult } from "../../upstream/apps/sheets/src/shared/desktop-api";
import type { IRange } from "@univerjs/core";
import { SheetInterceptorService } from "@univerjs/sheets";
import { canEditRange, canExecuteCommand } from "./command-policy";
import { parseCellText } from "./cell-input";
import { installShiftedNavigation } from "./shifted-navigation";
import { loadWorkbookFonts, type XlsxRendererFontMapping } from "./fonts";
import { ingestCellMutation, type XlsxRendererCellEdit } from "./edits";
import { t } from "./locale";
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
import { installNumberFormatFix } from "../../upstream/apps/sheets/src/renderer/numfmt-fix";
import { installRichTextBidiFix } from "../../upstream/apps/sheets/src/renderer/rich-text-bidi-fix";
import { installRtlGridMirror } from "../../upstream/apps/sheets/src/renderer/rtl-grid-mirror";
import { installRtlTextDirectionFix } from "../../upstream/apps/sheets/src/renderer/rtl-text-fix";
import { installThickBorderFix } from "../../upstream/apps/sheets/src/renderer/thick-border-fix";
import {
  installFindRevealFix,
  installInjectorResolutionGuard,
  installWrapMeasureLifecycle,
  loadVisibleRange,
  loadWorkbookSkeleton,
  revealCellBelowFreeze,
} from "../../upstream/apps/sheets/src/renderer/univer-sync";
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
  onEdits?: (edits: XlsxRendererCellEdit[]) => void;
  onSelectionChange?: (selection: { sheetId: string; range: IRange } | null) => void;
}

type DesktopApi = Record<string, unknown>;

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
  setDarkMode(dark: boolean): void;
  undo(): void;
  redo(): void;
  getDirtyGeneration(): number;
  getFontMappings(): readonly XlsxRendererFontMapping[];
  getJournal(): EditJournal;
  dispose(): void;
}

const RENDERER_ROOT_CLASS = "xlsx-surface";
const UNIVER_CONTAINER_CLASS = "xlsx-univer-container";

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
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(
        UniverPresetSheetsCoreEnUS,
        UniverPresetSheetsConditionalFormattingEnUS,
        UniverPresetSheetsFilterEnUS,
        UniverPresetSheetsDataValidationEnUS,
        UniverPresetSheetsNoteEnUS,
        UniverPresetSheetsFindReplaceEnUS,
        UniverPresetSheetsSortEnUS,
        UniverPresetSheetsTableEnUS,
      ),
    },
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
  let fontMappings: XlsxRendererFontMapping[] = [];
  let disposed = false;
  let commitInProgress = false;
  let commitDenied = false;
  let loadingWorkbook = false;
  let lastSelectionState: LazyWorkbookState | null = null;
  let lastSelectionKey: string | undefined;

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
    getState: () => loadingWorkbook ? null : lazyWorkbookRef.current, readOnly: options.readOnly ?? false, commitEdit,
    onFailure: () => setMessage("xlsx_cell_edit_commit_failed"),
  });

  const themeService = runtime.univer.__getInjector().get(ThemeService);

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
    if (lastSelectionState === state && lastSelectionKey === key) return;
    lastSelectionState = state;
    lastSelectionKey = key;
    options.onSelectionChange?.(selection);
  };

  // Viewport streaming: scroll and sheet switches refetch the visible window.
  const disposables: Array<{ dispose(): void }> = [];
  disposables.push(runtime.univerAPI.addEvent(runtime.univerAPI.Event.BeforeCommandExecute, (event) => {
    if (journalSuppression.active) return;
    if (!canExecuteCommand(event, lazyWorkbookRef.current, options.readOnly ?? false)) {
      if (commitInProgress) commitDenied = true;
      event.cancel = true;
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
  disposables.push(runtime.univerAPI.addEvent(runtime.univerAPI.Event.Scroll, () => refreshViewport()));
  disposables.push(
    runtime.univerAPI.addEvent(runtime.univerAPI.Event.ActiveSheetChanged, () =>
      window.setTimeout(() => { refreshViewport(); notifySelection(); }, 0),
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
      const edits = ingestCellMutation(
        lazyWorkbookRef.current, event, journalSuppression.active,
        sheetId ? sharedFormulaResolverFor(runtime, sheetId) : undefined,
        (row, column) => {
          const style = workbook?.getWorkbook().getStyles().getStyleByCell(sheet?.getSheet().getCellRaw(row, column));
          return style ? { ...style } : undefined;
        },
      );
      if (edits.length === 0) return;
      dirtyGeneration += 1;
      options.onEdits?.(edits);
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
      } finally {
        loadAutoHeightSuppression.active = false;
        journalSuppression.active = false;
      }
      const state = createLazyState(file);
      lazyWorkbookRef.current = state;
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
    dispose() {
      disposed = true;
      removeShiftedNavigation();
      for (const disposable of disposables) disposable.dispose();
      findRevealDispose?.();
      numberFormatDispose?.dispose();
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
