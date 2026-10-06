"use client";

// UNI-940 X02 (B8): the editor wiring for charts, pictures and shapes. Like
// protect/use-protect-names it owns its state and rides the editor's edit
// channel: an insert sends set_visual with its body once, a move or resize
// the anchor-only set_visual, a delete remove_visual; the engine folds them by
// id and writes new drawing parts on save. While a save is in flight visuals
// are frozen (no insert, move or delete): a move typed after the save's
// snapshot would address a visual the next base already holds in the file,
// and the runtimes drop the draft op stream when a save commits, so an insert
// typed in that window would recover as a move with no insert before it. The overlay is positioned through the renderer's geometry seam
// (getCellBox / cellAtPoint) and re-measured on every viewport change.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { XlsxVisualChartType, XlsxVisualShapeType } from "@uniwork/office-engine/xlsx";
import type { XlsxSelection } from "../types";
import { selectionSpan } from "../toolbar/structure-insert";
import { buildChartFromRange, clampChartRange, trimBlankEdges } from "./chart-data";
import { fitPicture, readPictureFile } from "./picture-file";
import { XlsxVisualLayer } from "./visual-layer";
import {
  anchorFromBox,
  boxFromAnchor,
  insertBoxAt,
  moveVisualOp,
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
  /** A save is in flight: visuals are not inserted, moved or deleted. */
  saving?: boolean;
  onApplied: () => void;
  onError: (message: string) => void;
}

interface XlsxVisualsWiring {
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
  const saving = options.saving === true;
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

  const available = canEdit && !saving && typeof edit === "function" && gridReady && activeSheetId !== null && geometry() !== null;

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

  /** Apply `next` locally, send `op`, and restore this visual's entry from
   *  `previous` if it fails (other visuals keep any later change). */
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
        const before = previous.find((visual) => visual.id === id);
        setVisuals((current) => {
          if (!before) return current.filter((visual) => visual.id !== id);
          return current.some((visual) => visual.id === id) ? current.map((visual) => (visual.id === id ? before : visual)) : [...current, before];
        });
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
    // Read a bounded slice (a whole column or sheet would freeze the tab),
    // then drop its empty tail.
    const range = clampChartRange(span);
    const raw = gridRef.current?.readRangeValues?.(activeSheetId, range) ?? null;
    const read = raw ? trimBlankEdges(raw.values, raw.display) : null;
    const chart = read ? buildChartFromRange({ values: read.values, display: read.display, range, sheetName: name, chartType }) : null;
    if (!chart || !read) {
      onError(t("office.xlsx.visuals.errors.noChartData"));
      return;
    }
    const width = read.values.reduce((max, row) => Math.max(max, row.length), 0);
    insert({ chart }, insertBoxAt(measure, activeSheetId, { row: span.startRow, column: range.startColumn + width }, CHART_SIZE));
    if ((span.endRow > range.endRow && read.lastRowFilled) || (span.endColumn > range.endColumn && read.lastColumnFilled)) {
      onError(t("office.xlsx.visuals.errors.chartClipped"));
    }
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
    if (!measure || !name || visual.saved || saving) return;
    const anchor = anchorFromBox(measure, visual.sheetId, box);
    if (!anchor) return;
    const moved = { ...visual, anchor };
    commit(visuals, visuals.map((candidate) => (candidate.id === visual.id ? moved : candidate)), moveVisualOp(moved, name), visual.id);
  }, [commit, geometry, saving, sheetName, visuals]);

  const remove = useCallback((visual: XlsxEditorVisual) => {
    const name = sheetName(visual.sheetId);
    if (!name || visual.saved || saving) return;
    if (selectedId === visual.id) setSelectedId(null);
    commit(visuals, visuals.filter((candidate) => candidate.id !== visual.id), removeVisualOp(visual, name), visual.id);
  }, [commit, saving, selectedId, sheetName, visuals]);

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
    ? <XlsxVisualLayer items={items} selectedId={selectedId} readOnly={!canEdit || saving} onSelect={setSelectedId} onMove={move} onRemove={remove} />
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
