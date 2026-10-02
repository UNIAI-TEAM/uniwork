"use client";

// G3-05c (UNI-824) - mount point for the vendored genoffice sheets renderer.
// The artifact is loaded lazily (the renderer is a chunk of its own; the
// documents first load must not carry it), mounted into a scoped container
// and disposed with the editor. The loader is injectable so component tests
// do not pull the 14 MB Univer bundle into jsdom.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { RendererRangeResult, RendererWorkbookFile } from "./xlsx-render-model-bridge";
import type { XlsxGridCellEdit } from "./xlsx-edit-bridge";

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
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
}

/** The subset of the artifact handle the surface uses. */
export interface XlsxGridHandle {
  loadWorkbook(file: RendererWorkbookFile, options?: { initialSheetId?: string }): Promise<void>;
  refreshViewport(): void;
  revealCell(sheetId: string, row: number, column: number): Promise<void>;
  setCellText(sheetId: string, row: number, column: number, text: string): void;
  selectSheet(sheetId: string): void;
  setNumberFormat(pattern: string): void;
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
    onEdits?: (edits: XlsxGridCellEdit[]) => void;
    onSelectionChange?: (selection: XlsxGridSelection | null) => void;
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
  onEdits?: (edits: XlsxGridCellEdit[]) => void;
  onMessage?: (message: string) => void;
  onSelectionChange?: (selection: XlsxGridSelection | null) => void;
  onReady?: () => void;
  onFailure?: (message: string) => void;
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
  loadModule = loadXlsxRendererModule,
  ref,
}: XlsxGridSurfaceProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<XlsxGridHandle | null>(null);
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const callbacksRef = useRef({ onDirty, onEdits, onMessage, onSelectionChange, onReady, onFailure, loadModule });
  callbacksRef.current = { onDirty, onEdits, onMessage, onSelectionChange, onReady, onFailure, loadModule };
  const [failed, setFailed] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      loadWorkbook: (file, options) => handleRef.current?.loadWorkbook(file, options) ?? Promise.reject(new Error("xlsx_renderer_not_ready")),
      refreshViewport: () => handleRef.current?.refreshViewport(),
      revealCell: (sheetId, row, column) => handleRef.current?.revealCell(sheetId, row, column) ?? Promise.resolve(),
      setCellText: (sheetId, row, column, text) => handleRef.current?.setCellText(sheetId, row, column, text),
      selectSheet: (sheetId) => handleRef.current?.selectSheet(sheetId),
      setNumberFormat: (pattern) => handleRef.current?.setNumberFormat(pattern),
      setDarkMode: (nextDark) => handleRef.current?.setDarkMode(nextDark),
      undo: () => handleRef.current?.undo(),
      redo: () => handleRef.current?.redo(),
      getDirtyGeneration: () => handleRef.current?.getDirtyGeneration() ?? 0,
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

  return (
    <div
      ref={containerRef}
      className={cn("relative min-h-0 flex-1 overflow-hidden bg-background", className)}
      data-testid="xlsx-grid-surface"
      data-document-key={documentKey}
      role="group"
      aria-label={t("office.xlsx.surface.grid")}
    >
      {failed ? (
        <p className="p-3 text-caption text-destructive" role="alert" data-testid="xlsx-grid-failure">
          {t("office.xlsx.errors.rendererFailed")}
        </p>
      ) : null}
    </div>
  );
}
