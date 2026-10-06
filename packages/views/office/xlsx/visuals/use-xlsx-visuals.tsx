"use client";

// UNI-940 X02 (B8): the editor wiring for charts, pictures and shapes. Like
// protect/use-protect-names it owns its state and rides the editor's edit
// channel: every insert, move, resize and delete sends one set_visual /
// remove_visual op the engine folds by id and writes as new drawing parts on
// save. The overlay is positioned through the renderer's geometry seam
// (getCellBox / cellAtPoint) and re-measured on every viewport change.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { XlsxVisualChartType, XlsxVisualShapeType } from "@uniwork/office-engine/xlsx";
import type { XlsxSelection } from "../types";
import { selectionSpan } from "../toolbar/structure-insert";
import { buildChartFromRange } from "./chart-data";
import { fitPicture, readPictureFile } from "./picture-file";
import { XlsxVisualLayer } from "./visual-layer";
import {
  anchorFromBox,
  boxFromAnchor,
  insertBoxAt,
  removeVisualOp,
  setVisualOp,
  type XlsxEditorVisual,
  type XlsxVisualBox,
  type XlsxVisualGeometry,
} from "./visual-model";
import { XlsxVisualsContext, type XlsxVisualsCommands } from "./visuals-context";

/** Default inserted sizes in unzoomed pixels (Excel's 5" x 3" chart). */
const CHART_SIZE = { width: 480, height: 288 };
const SHAPE_SIZE = { width: 160, height: 96 };
const PICTURE_MAX = 480;
/** Office's default accent 1, written into the file as the shape fill. */
const SHAPE_FILL = "#4472C4";

/** The grid handle members this hook reads; optional so a host without the
 *  geometry seam simply offers no visuals. */
export interface XlsxVisualsGrid {
  getCellBox?: XlsxVisualGeometry["getCellBox"];
  cellAtPoint?: XlsxVisualGeometry["cellAtPoint"];
  readRangeValues?(
    sheetId: string,
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  ): { values: readonly (readonly (string | number | boolean | null)[])[]; display: readonly (readonly string[])[] } | null;
}

export interface XlsxVisualsOptions {
  gridRef: MutableRefObject<XlsxVisualsGrid | null>;
  gridReady: boolean;
  selection: XlsxSelection | null;
  /** The sheet on screen: its grid id when known, else its live name. */
  activeSheetId: string | null;
  activeSheetName: string | null;
  /** The live sheets (grid id + current name); op targets resolve by name. */
  sheets: readonly { readonly id: string; readonly name: string }[];
  canEdit: boolean;
  /** The edit channel and its dirty generation (stamped on each visual op). */
  editor: { edit?: ((ops: readonly unknown[]) => Promise<void> | void) | undefined; getDirtyGeneration(): number };
  /** The coordinator's last saved generation. */
  savedGeneration: number;
  onApplied: () => void;
  onError: (message: string) => void;
}

export interface XlsxVisualsWiring {
  commands: XlsxVisualsCommands;
  /** Rendered inside the grid surface, above the canvas. */
  overlay: ReactNode;
  /** The renderer's onViewportChange: re-measure on the next frame. */
  onViewportChange: () => void;
  /** The hidden picture input. */
  dialog: ReactNode;
}

let visualSequence = 0;
const nextVisualId = () => `v${Date.now().toString(36)}${(visualSequence += 1).toString(36)}`;

export function useXlsxVisuals(options: XlsxVisualsOptions): XlsxVisualsWiring {
  const { gridRef, gridReady, selection, sheets, canEdit, editor, savedGeneration, onApplied, onError } = options;
  const { edit } = editor;
  const activeSheetId = options.activeSheetId ?? sheets.find((sheet) => sheet.name === options.activeSheetName)?.id ?? null;
  const sheetName = useCallback((sheetId: string) => sheets.find((sheet) => sheet.id === sheetId)?.name, [sheets]);
  const generation = useCallback(() => editor.getDirtyGeneration(), [editor]);
  const { t } = useTranslation();
  const [visuals, setVisuals] = useState<readonly XlsxEditorVisual[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, setLayoutTick] = useState(0);
  const frameRef = useRef<number | null>(null);
  const pictureInputRef = useRef<HTMLInputElement>(null);

  const geometry = useCallback((): XlsxVisualGeometry | null => {
    const grid = gridRef.current;
    if (!gridReady || !grid?.getCellBox || !grid.cellAtPoint) return null;
    return { getCellBox: grid.getCellBox.bind(grid), cellAtPoint: grid.cellAtPoint.bind(grid) };
  }, [gridReady, gridRef]);

  const available = canEdit && typeof edit === "function" && gridReady && activeSheetId !== null && geometry() !== null;

  const onViewportChange = useCallback(() => {
    if (frameRef.current !== null) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback: () => void) => window.setTimeout(callback, 16);
    frameRef.current = schedule(() => {
      frameRef.current = null;
      setLayoutTick((tick) => tick + 1);
    }) as number;
  }, []);

  // The window resizing moves the canvas too.
  useEffect(() => {
    window.addEventListener("resize", onViewportChange);
    return () => window.removeEventListener("resize", onViewportChange);
  }, [onViewportChange]);

  // A save that covers a visual's last op wrote it into the file: lock it.
  useEffect(() => {
    setVisuals((current) => (current.some((visual) => !visual.saved && visual.generation > 0 && visual.generation <= savedGeneration)
      ? current.map((visual) => (!visual.saved && visual.generation > 0 && visual.generation <= savedGeneration ? { ...visual, saved: true } : visual))
      : current));
  }, [savedGeneration]);

  /** Apply `next` locally, send `op`, and restore `previous` if it fails. */
  const commit = useCallback((previous: readonly XlsxEditorVisual[], next: readonly XlsxEditorVisual[], op: Record<string, unknown>, id: string) => {
    if (!edit) return;
    setVisuals(next);
    void Promise.resolve(edit([op]))
      .then(() => {
        const stamp = generation();
        setVisuals((current) => current.map((visual) => (visual.id === id ? { ...visual, generation: stamp } : visual)));
        onApplied();
      })
      .catch((error: unknown) => {
        setVisuals(previous);
        onError(error instanceof Error ? error.message : String(error));
      });
  }, [edit, generation, onApplied, onError]);

  const insert = useCallback((body: Pick<XlsxEditorVisual, "chart" | "shape" | "image">, box: XlsxVisualBox | null) => {
    const measure = geometry();
    const name = activeSheetId === null ? undefined : sheetName(activeSheetId);
    if (!available || !measure || activeSheetId === null || !name || !box) return;
    const anchor = anchorFromBox(measure, activeSheetId, box);
    if (!anchor) return;
    const visual: XlsxEditorVisual = { id: nextVisualId(), sheetId: activeSheetId, anchor, ...body, generation: 0, saved: false };
    commit(visuals, [...visuals, visual], setVisualOp(visual, name), visual.id);
    setSelectedId(visual.id);
  }, [activeSheetId, available, commit, geometry, sheetName, visuals]);

  const span = useMemo(() => selectionSpan(selection), [selection]);
  const anchorCell = useMemo(() => (span ? { row: span.startRow, column: span.startColumn } : { row: 0, column: 0 }), [span]);

  const insertChart = useCallback((chartType: XlsxVisualChartType) => {
    const measure = geometry();
    const name = activeSheetId === null ? undefined : sheetName(activeSheetId);
    if (!measure || !span || activeSheetId === null || !name) return;
    const read = gridRef.current?.readRangeValues?.(activeSheetId, span) ?? null;
    const chart = read ? buildChartFromRange({ values: read.values, display: read.display, range: span, sheetName: name, chartType }) : null;
    if (!chart) {
      onError(t("office.xlsx.visuals.errors.noChartData"));
      return;
    }
    insert({ chart }, insertBoxAt(measure, activeSheetId, { row: span.startRow, column: span.endColumn + 1 }, CHART_SIZE));
  }, [activeSheetId, geometry, gridRef, insert, onError, sheetName, span, t]);

  const insertShape = useCallback((shapeType: XlsxVisualShapeType) => {
    const measure = geometry();
    if (!measure || activeSheetId === null) return;
    const shape = shapeType === "line" ? { shapeType } : { shapeType, fillColor: SHAPE_FILL };
    insert({ shape }, insertBoxAt(measure, activeSheetId, anchorCell, SHAPE_SIZE));
  }, [activeSheetId, anchorCell, geometry, insert]);

  const onPicture = useCallback(async (file: File) => {
    const read = await readPictureFile(file);
    if (!read.ok) {
      onError(t(`office.xlsx.visuals.errors.picture.${read.reason}`));
      return;
    }
    const measure = geometry();
    if (!measure || activeSheetId === null) return;
    insert({ image: { mediaType: read.mediaType, base64: read.base64 } }, insertBoxAt(measure, activeSheetId, anchorCell, fitPicture(read, PICTURE_MAX)));
  }, [activeSheetId, anchorCell, geometry, insert, onError, t]);

  const move = useCallback((visual: XlsxEditorVisual, box: XlsxVisualBox) => {
    const measure = geometry();
    const name = sheetName(visual.sheetId);
    if (!measure || !name || visual.saved) return;
    const anchor = anchorFromBox(measure, visual.sheetId, box);
    if (!anchor) return;
    const moved = { ...visual, anchor };
    commit(visuals, visuals.map((candidate) => (candidate.id === visual.id ? moved : candidate)), setVisualOp(moved, name), visual.id);
  }, [commit, geometry, sheetName, visuals]);

  const remove = useCallback((visual: XlsxEditorVisual) => {
    const name = sheetName(visual.sheetId);
    if (!name || visual.saved) return;
    if (selectedId === visual.id) setSelectedId(null);
    commit(visuals, visuals.filter((candidate) => candidate.id !== visual.id), removeVisualOp(visual, name), visual.id);
  }, [commit, selectedId, sheetName, visuals]);

  const measure = geometry();
  const items = activeSheetId === null || !measure
    ? []
    : visuals
        .filter((visual) => visual.sheetId === activeSheetId)
        .map((visual) => ({ visual, box: boxFromAnchor(measure, activeSheetId, visual.anchor) }));

  const commands = useMemo<XlsxVisualsCommands>(() => ({
    available,
    canInsertChart: available && span !== null && (span.rows > 1 || span.columns > 1),
    insertChart,
    insertShape,
    insertPicture: () => { if (available) pictureInputRef.current?.click(); },
  }), [available, insertChart, insertShape, span]);

  const overlay = items.length > 0
    ? <XlsxVisualLayer items={items} selectedId={selectedId} readOnly={!canEdit} onSelect={setSelectedId} onMove={move} onRemove={remove} />
    : null;

  const dialog = (
    <input
      ref={pictureInputRef}
      type="file"
      accept="image/png,image/jpeg,image/gif"
      className="hidden"
      tabIndex={-1}
      aria-label={t("office.xlsx.visuals.picture.label")}
      data-testid="xlsx-visual-picture-input"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void onPicture(file);
      }}
    />
  );

  return { commands, overlay, onViewportChange, dialog };
}

/** Gives the ribbon groups the commands and mounts the hidden picture input. */
export function XlsxVisualsProvider({ visuals, children }: { visuals: XlsxVisualsWiring; children: ReactNode }) {
  return (
    <XlsxVisualsContext.Provider value={visuals.commands}>
      {children}
      {visuals.dialog}
    </XlsxVisualsContext.Provider>
  );
}
