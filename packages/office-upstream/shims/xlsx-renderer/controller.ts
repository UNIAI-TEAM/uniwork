// G3-05c (UNI-824) - UniWork-authored controller around the vendored genoffice
// sheets renderer. The vendored modules are Apache-2.0 source from the pin;
// this file is UniWork code: it owns the Univer instance lifecycle, the
// genoffice host-port bridge (window.desktopApi) and the public renderer API
// the shared XlsxEditor mounts. No vendored file is edited here.
import {
  BooleanNumber,
  IUndoRedoService,
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
  type UniverRuntime,
} from "../../upstream/apps/sheets/src/renderer/univer-sync";
import {
  installJournalSuppressionUndoFilter,
  installLoadAutoHeightGate,
  journalSuppression,
  loadAutoHeightSuppression,
  lazySheetScreenExtent,
  type LazyWorkbookState,
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
  onMessage?: (message: string) => void;
  onDirty?: () => void;
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
  undo(): void;
  redo(): void;
  getDirtyGeneration(): number;
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
        header: true,
        toolbar: false,
        contextMenu: true,
        formulaBar: true,
        footer: {
          sheetBar: true,
          statisticBar: true,
          menus: true,
          zoomSlider: false,
        },
        statusBarStatistic: true,
        sheets: { isRowStylePrecedeColumnStyle: true },
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
  const findRevealDispose = installFindRevealFix(runtime);
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
  installForceStringMarkGate(runtime.univer.__getInjector().get(SheetInterceptorService));
  installFormulaStreamHold(runtime);

  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: null };
  let dirtyGeneration = 0;

  const themeService = runtime.univer.__getInjector().get(ThemeService);
  const undoRedoService = runtime.univer.__getInjector().get(IUndoRedoService);

  const refreshViewport = () => {
    const state = lazyWorkbookRef.current;
    const active = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet();
    if (!state || !active) return;
    void loadVisibleRange(runtime, lazyWorkbookRef, active, setMessage).catch(() => undefined);
  };

  // Viewport streaming: scroll and sheet switches refetch the visible window.
  const disposables: Array<{ dispose(): void }> = [];
  disposables.push(runtime.univerAPI.addEvent(runtime.univerAPI.Event.Scroll, () => refreshViewport()));
  disposables.push(
    runtime.univerAPI.addEvent(runtime.univerAPI.Event.ActiveSheetChanged, () =>
      window.setTimeout(refreshViewport, 0),
    ),
  );
  disposables.push(
    runtime.univerAPI.addEvent(runtime.univerAPI.Event.SelectionChanged, () => {
      const workbook = runtime.univerAPI.getActiveWorkbook();
      const sheet = workbook?.getActiveSheet();
      const range = workbook?.getActiveRange()?.getRange();
      if (!sheet || !range) {
        options.onSelectionChange?.(null);
        return;
      }
      options.onSelectionChange?.({ sheetId: sheet.getSheetId(), range });
    }),
  );
  disposables.push(
    runtime.univerAPI.addEvent(runtime.univerAPI.Event.CommandExecuted, () => {
      // Any command that mutates the workbook invalidates the saved state; the
      // precise cell journaling is wired by the save bridge in the next stage.
      dirtyGeneration += 1;
      options.onDirty?.();
    }),
  );

  return {
    async loadWorkbook(file, loadOptions) {
      journalSuppression.active = true;
      loadAutoHeightSuppression.active = true;
      try {
        loadWorkbookSkeleton(runtime, file);
      } finally {
        loadAutoHeightSuppression.active = false;
        journalSuppression.active = false;
      }
      const state = createLazyState(file);
      lazyWorkbookRef.current = state;
      const active = loadOptions?.initialSheetId
        ? runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(loadOptions.initialSheetId)
        : runtime.univerAPI.getActiveWorkbook()?.getActiveSheet();
      if (active) await loadVisibleRange(runtime, lazyWorkbookRef, active, setMessage);
    },
    refreshViewport,
    async revealCell(sheetId, row, column) {
      const worksheet = runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(sheetId);
      if (!worksheet) return;
      await revealCellBelowFreeze(worksheet, row, column);
    },
    undo() {
      void runtime.univerAPI.undo();
    },
    redo() {
      void runtime.univerAPI.redo();
    },
    getDirtyGeneration: () => dirtyGeneration,
    getJournal: () => {
      const state = lazyWorkbookRef.current;
      if (!state) throw new Error("xlsx renderer has no workbook loaded");
      return state.editJournal;
    },
    dispose() {
      for (const disposable of disposables) disposable.dispose();
      findRevealDispose?.();
      wrapMeasureDisposable?.dispose();
      lazyWorkbookRef.current = null;
      try {
        runtime.univer.dispose();
      } catch {
        /* a disposed injector must not throw during teardown */
      }
      univerHost.remove();
      container.classList.remove(RENDERER_ROOT_CLASS);
      restoreDesktopApi();
    },
  };
}

export { BooleanNumber };
