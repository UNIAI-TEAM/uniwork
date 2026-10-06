"use client";

// G3-05c (UNI-824) - mount point for the vendored genoffice sheets renderer.
// The artifact is loaded lazily (the renderer is a chunk of its own; the
// documents first load must not carry it), mounted into a scoped container
// and disposed with the editor. The loader is injectable so component tests
// do not pull the 14 MB Univer bundle into jsdom.
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { RendererRangeResult, RendererWorkbookFile } from "./xlsx-render-model-bridge";
import type { XlsxGridEdit } from "./xlsx-edit-bridge";
import type { XlsxGridRange } from "./selection-mapping";
import type { XlsxVisualsGrid } from "./visuals/use-xlsx-visuals";
import type { XlsxDroppedRuleSet } from "./conditional-format/rule-set-drops";

export interface XlsxGridHostPort {
  file: RendererWorkbookFile;
  readRange(input: {
    sessionId: string;
    sheetId: string;
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  }): Promise<RendererRangeResult>;
}

export interface XlsxGridSelection {
  sheetId: string;
  range: XlsxGridRange;
}

/** The active-selection style the renderer mirrors back for the toolbar
 *  controls. Alignment numbers are the pinned Univer style values
 *  (horizontal 1=left/2=center/3=right; vertical 1=top/2=middle/3=bottom);
 *  rotation is degrees; null means the cell declares no value for the field. */
export interface XlsxGridFormatState {
  fontFamily: string | null;
  fontSize: number | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  textColor: string | null;
  fillColor: string | null;
  horizontalAlign: number | null;
  verticalAlign: number | null;
  wrap: boolean;
  textRotation: number | null;
}

/** One live sheet as the tab strip reads it (order = tab order). */
export interface XlsxGridSheetInfo {
  readonly id: string;
  readonly name: string;
  readonly hidden: boolean;
}

/** The subset of the artifact handle the surface uses. The visuals members
 *  (getCellBox / cellAtPoint / readRangeValues, UNI-940) are optional. */
export interface XlsxGridHandle extends XlsxVisualsGrid {
  loadWorkbook(file: RendererWorkbookFile, options?: { initialSheetId?: string }): Promise<void>;
  refreshViewport(): void;
  revealCell(sheetId: string, row: number, column: number): Promise<void>;
  setCellText(sheetId: string, row: number, column: number, text: string): void;
  commitEdit(): Promise<void>;
  selectSheet(sheetId: string): void;
  setNumberFormat(pattern: string): void;
  /** Run an allowlisted Univer command on the active selection (false when
   *  the renderer refuses it: read-only, no active range, or policy). */
  executeCommand(id: string, params?: unknown): boolean | Promise<boolean>;
  /** UNI-953: several commands as ONE undo entry (a rich paste); optional so
   *  test doubles that only exercise the cell ports stay valid. */
  executeCommandsAsOneStep?(steps: readonly { id: string; params?: unknown }[]): Promise<boolean>;
  /** The active range's composed style, or null without an active range. */
  getActiveFormatState(): XlsxGridFormatState | null;
  /** The live sheet list in tab order; optional so test doubles that only
   *  exercise the cell ports stay valid. */
  getSheets?(): readonly XlsxGridSheetInfo[];
  /** r3 MA-3: after a save dropped a CF/DV family of a sheet, refuse it for
   *  the session and show the rules the file holds (null: as opened). */
  restoreRuleSet?(sheetId: string, family: XlsxDroppedRuleSet["family"], rules: XlsxDroppedRuleSet["savedRules"]): boolean;
  setDarkMode(dark: boolean): void;
  undo(): void;
  redo(): void;
  getDirtyGeneration(): number;
  dispose(): void;
}

export interface XlsxRendererModule {
  createXlsxRenderer(options: {
    container: HTMLElement;
    host: XlsxGridHostPort;
    dark?: boolean;
    readOnly?: boolean;
    onMessage?: (message: string) => void;
    onDirty?: () => void;
    onEdits?: (edits: XlsxGridEdit[]) => void;
    onSelectionChange?: (selection: XlsxGridSelection | null) => void;
    onViewportChange?: () => void;
  }): XlsxGridHandle;
  installXlsxRendererStyles(doc?: Document): void;
}

/** The production loader: the artifact resolves through the package export. */
export async function loadXlsxRendererModule(): Promise<XlsxRendererModule> {
  return import("@uniwork/office-upstream/xlsx-renderer");
}

export interface XlsxGridSurfaceProps {
  documentKey: string;
  host: XlsxGridHostPort;
  dark?: boolean;
  readOnly?: boolean;
  className?: string;
  onDirty?: () => void;
  onEdits?: (edits: XlsxGridEdit[]) => void;
  onMessage?: (message: string) => void;
  onSelectionChange?: (selection: XlsxGridSelection | null) => void;
  onReady?: () => void;
  onFailure?: (message: string) => void;
  /** Right-click on the grid: the editor opens its context menu at the point
   *  and returns focus to `container` when the menu closes. Absent = no menu. */
  onContextMenu?: (point: { x: number; y: number }, container: HTMLElement) => void;
  /** UNI-940: the visual overlay drawn above the canvas, and the renderer's
   *  signal that the grid moved under it (scroll, zoom, sheet switch). */
  overlay?: ReactNode;
  onViewportChange?: () => void;
  /** Test seam: resolves the artifact without the real chunk. */
  loadModule?: () => Promise<XlsxRendererModule>;
  ref?: Ref<XlsxGridHandle>;
}

/**
 * Mounts the vendored renderer for one workbook. The effect is keyed on the
 * document key: changing documents tears the Univer instance down and mounts
 * a fresh one, mirroring the G3-05a session lifetime.
 */
export function XlsxGridSurface({
  documentKey,
  host,
  dark = false,
  readOnly = false,
  className,
  onDirty,
  onEdits,
  onMessage,
  onSelectionChange,
  onReady,
  onFailure,
  onContextMenu,
  overlay,
  onViewportChange,
  loadModule = loadXlsxRendererModule,
  ref,
}: XlsxGridSurfaceProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<XlsxGridHandle | null>(null);
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const callbacksRef = useRef({ onDirty, onEdits, onMessage, onSelectionChange, onViewportChange, onReady, onFailure, loadModule });
  callbacksRef.current = { onDirty, onEdits, onMessage, onSelectionChange, onViewportChange, onReady, onFailure, loadModule };
  const [failed, setFailed] = useState(false);
  const contextMenuRef = useRef(onContextMenu);
  contextMenuRef.current = onContextMenu;

  useImperativeHandle(
    ref,
    () => ({
      loadWorkbook: (file, options) => handleRef.current?.loadWorkbook(file, options) ?? Promise.reject(new Error("xlsx_renderer_not_ready")),
      refreshViewport: () => handleRef.current?.refreshViewport(),
      revealCell: (sheetId, row, column) => handleRef.current?.revealCell(sheetId, row, column) ?? Promise.resolve(),
      setCellText: (sheetId, row, column, text) => handleRef.current?.setCellText(sheetId, row, column, text),
      commitEdit: () => handleRef.current?.commitEdit() ?? Promise.reject(new Error("xlsx_renderer_not_ready")),
      selectSheet: (sheetId) => handleRef.current?.selectSheet(sheetId),
      setNumberFormat: (pattern) => handleRef.current?.setNumberFormat(pattern),
      executeCommand: (id, params) => handleRef.current?.executeCommand(id, params) ?? false,
      executeCommandsAsOneStep: (steps) => handleRef.current?.executeCommandsAsOneStep(steps) ?? Promise.resolve(false),
      getActiveFormatState: () => handleRef.current?.getActiveFormatState() ?? null,
      getSheets: () => handleRef.current?.getSheets?.() ?? [],
      restoreRuleSet: (sheetId, family, rules) => handleRef.current?.restoreRuleSet?.(sheetId, family, rules) ?? false,
      setDarkMode: (nextDark) => handleRef.current?.setDarkMode(nextDark),
      undo: () => handleRef.current?.undo(),
      redo: () => handleRef.current?.redo(),
      getDirtyGeneration: () => handleRef.current?.getDirtyGeneration() ?? 0,
      getCellBox: (sheetId, row, column) => handleRef.current?.getCellBox?.(sheetId, row, column) ?? null,
      cellAtPoint: (sheetId, x, y) => handleRef.current?.cellAtPoint?.(sheetId, x, y) ?? null,
      readRangeValues: (sheetId, range) => handleRef.current?.readRangeValues?.(sheetId, range) ?? null,
      dispose: () => {
        handleRef.current?.dispose();
        handleRef.current = null;
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let disposed = false;
    setFailed(false);
    void (async () => {
      try {
        const module = await callbacksRef.current.loadModule();
        if (disposed) return;
        module.installXlsxRendererStyles(container.ownerDocument);
        const handle = module.createXlsxRenderer({
          container,
          host,
          dark: darkRef.current,
          readOnly,
          onMessage: (message) => callbacksRef.current.onMessage?.(message),
          onDirty: () => callbacksRef.current.onDirty?.(),
          onEdits: (edits) => callbacksRef.current.onEdits?.(edits),
          onSelectionChange: (selection) => callbacksRef.current.onSelectionChange?.(selection),
          onViewportChange: () => callbacksRef.current.onViewportChange?.(),
        });
        if (disposed) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        await handle.loadWorkbook(host.file);
        if (disposed) return;
        handle.setDarkMode(darkRef.current);
        callbacksRef.current.onReady?.();
      } catch (error) {
        if (disposed) return;
        setFailed(true);
        callbacksRef.current.onFailure?.(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // Theme switches preserve the live workbook and undo journal.
  }, [documentKey, host, readOnly]);

  useEffect(() => { handleRef.current?.setDarkMode(dark); }, [dark]);

  // The Univer input lives in a nested React root, so the right click is caught
  // natively in the capture phase: it cannot be swallowed by a child handler
  // and it reaches us before the browser menu would open.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onNativeContextMenu = (event: MouseEvent) => {
      if (!contextMenuRef.current) return;
      event.preventDefault();
      contextMenuRef.current({ x: event.clientX, y: event.clientY }, container);
    };
    container.addEventListener("contextmenu", onNativeContextMenu, true);
    return () => container.removeEventListener("contextmenu", onNativeContextMenu, true);
  }, []);

  // The container is focusable only programmatically (tabIndex -1): the
  // context menu returns focus here on Escape/close, and a plain <div> would
  // ignore focus(). The grid keeps its own Tab order inside the nested
  // renderer root.
  return (
    <div
      ref={containerRef}
      className={cn("relative h-[min(55vh,32rem)] min-h-64 min-w-0 flex-auto overflow-hidden bg-background", className)}
      data-testid="xlsx-grid-surface"
      data-document-key={documentKey}
      role="group"
      aria-label={t("office.xlsx.surface.grid")}
      tabIndex={-1}
    >
      {failed ? (
        <p className="p-3 text-caption text-destructive" role="alert" data-testid="xlsx-grid-failure">
          {t("office.xlsx.errors.rendererFailed")}
        </p>
      ) : null}
      {failed ? null : overlay}
    </div>
  );
}
