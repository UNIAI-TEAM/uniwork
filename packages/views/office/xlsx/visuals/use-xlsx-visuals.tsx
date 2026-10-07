"use client";

// UNI-940 X02 (B8): the editor wiring for charts, pictures and shapes. Like
// protect/use-protect-names it owns its state and rides the editor's edit
// channel: an insert sends set_visual with its body once, a move or resize
// the anchor-only set_visual, a delete remove_visual; the engine folds them by
// id and writes new drawing parts on save. While a save is in flight visuals
// cannot be moved or deleted: an op typed after the save's snapshot would
// address a visual the next base already holds in the file, which the save
// path refuses. Inserting stays open: a new visual is a new id the next save
// carries, and every host keeps it in the draft op stream across the commit.
// Visuals already in the file (UNI-953) arrive with the render model and are
// addressed by drawing index ({ file }); once a save lands, the visuals it
// wrote join them (visual-file.ts renumbers), so nothing locks after Save.
// The overlay is positioned through the renderer's geometry seam
// (getCellBox / cellAtPoint) and re-measured on every viewport change.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { XlsxRenderVisual, XlsxVisualChartType, XlsxVisualShapeType } from "@uniwork/office-engine/xlsx";
import type { XlsxSelection } from "../types";
import { selectionSpan } from "../toolbar/structure-insert";
import { buildChartFromRange, clampChartRange, trimBlankEdges } from "./chart-data";
import { fitPicture, readPictureFile } from "./picture-file";
import { XlsxVisualLayer } from "./visual-layer";
import { fileEditsFromStream, visualsFromStream } from "./visual-recovery";
import { applySavedVisuals, boxOfVisual, seedFileVisuals, type XlsxPendingFileRemoval } from "./visual-file";
import { appendedFrom, applyOverlayShifts, streamOpKeys, structuralShiftsOf } from "./visual-structure";
import { gridSheetMetrics, printableVisuals, type XlsxPrintSheetMetrics, type XlsxPrintableVisual } from "./visual-print";
import {
  anchorFromBox,
  insertBoxAt,
  moveVisualOp,
  removeVisualOp,
  setVisualOp,
  type XlsxEditorVisual,
  type XlsxVisualBox,
  type XlsxVisualGeometry,
} from "./visual-model";
import { applyVisualHistory, type XlsxVisualHistoryDirection, type XlsxVisualHistoryDraft, type XlsxVisualHistoryEntry } from "./visual-history";
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
  /** A cell edit is open (null: cannot tell); Delete in the grid's editor input waits for it. */
  isCellEditing?(): boolean | null;
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
  /** A save is in flight: visuals may be inserted but not moved or deleted. */
  saving?: boolean;
  /** The editor's workbook snapshot; a recovered draft carries its raw op
   *  stream as `pendingOps`, whose visuals the overlay draws again. */
  snapshot?: unknown;
  /** The opened file's own visuals per sheet id (XlsxModelHost.fileVisuals). */
  fileVisuals?: Readonly<Record<string, readonly XlsxRenderVisual[]>> | undefined;
  /** The grid's undo depth now (0 without a history port): orders visual
   *  history entries against grid edits. */
  gridUndos?: number;
  /** Old grid entries the full stack has dropped (monotonic): each one lowers
   *  the depth a visual step was recorded at (review r3 F3a). */
  gridDropped?: number;
  onApplied: () => void;
  onError: (message: string) => void;
}

/** Undo/redo of visual moves, inserts and deletes (the grid stack never sees them). */
export interface XlsxVisualsHistory {
  /** The next undo is a visual step: no grid edit came after it. */
  canUndo: boolean;
  /** The next redo is a visual step: the grid is back at the depth it was recorded at. */
  canRedo: boolean;
  /** A visual is selected (so no cell is being edited). */
  selected: boolean;
  undo: () => void;
  redo: () => void;
}

interface XlsxVisualsWiring {
  commands: XlsxVisualsCommands;
  /** Rendered inside the grid surface, above the canvas. */
  overlay: ReactNode;
  /** The renderer's onViewportChange: re-measure on the next frame. */
  onViewportChange: () => void;
  history: XlsxVisualsHistory;
  /** The grid's cell-edit state (null: cannot tell), for the undo keys. */
  isCellEditing: () => boolean | null;
  /** The hidden picture input. */
  dialog: ReactNode;
  /** Print (L1): the drawn visuals of one sheet (or all), positioned in sheet
   *  px at 100% zoom. Without `metricsFor` only the sheet on screen is sized
   *  (from the live grid); other sheets come back with `box: null`. */
  getPrintableVisuals(sheetId?: string, metricsFor?: (sheetId: string) => XlsxPrintSheetMetrics | null): XlsxPrintableVisual[];
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
  /** Every id this overlay has held: a recovered stream only adds the others. */
  const knownIdsRef = useRef(new Set<string>());
  /** File visual deletes the next save carries (they renumber the drawing). */
  const removalsRef = useRef<readonly XlsxPendingFileRemoval[]>([]);
  /** A recovered stream's file edits apply once, before any local edit. */
  const fileStreamRef = useRef<"pending" | "done">("pending");
  const { fileVisuals } = options;
  /** The op stream already scanned for row/column shifts (and its keys). */
  const streamSeenRef = useRef<{ ops: readonly unknown[]; keys: readonly string[] }>({ ops: [], keys: [] });
  const sheetIdOf = useCallback((name: string) => sheets.find((sheet) => sheet.name === name)?.id, [sheets]);
  /** Seeding follows the open, never a sheet rename, so it reads the live lookup here. */
  const sheetIdOfRef = useRef(sheetIdOf);
  useEffect(() => {
    sheetIdOfRef.current = sheetIdOf;
  }, [sheetIdOf]);
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const [past, setPast] = useState<readonly XlsxVisualHistoryEntry[]>([]);
  const [future, setFuture] = useState<readonly XlsxVisualHistoryEntry[]>([]);
  const gridUndos = options.gridUndos ?? 0;
  const gridUndosRef = useRef(gridUndos);
  gridUndosRef.current = gridUndos;
  // The grid stack is capped: a push at the cap drops its oldest entry and
  // leaves the depth alone, so every recorded depth moves down with it. A new
  // grid edit above a visual redo's depth drops that redo branch, like Excel
  // (review r3 F3a/b).
  const gridDropped = options.gridDropped ?? 0;
  const droppedRef = useRef(gridDropped);
  useEffect(() => {
    const shift = gridDropped - droppedRef.current;
    droppedRef.current = gridDropped;
    const lower = <T extends XlsxVisualHistoryEntry>(entries: readonly T[]) => (shift > 0 ? entries.map((entry) => ({ ...entry, gridUndos: entry.gridUndos - shift })) : entries);
    if (shift > 0) setPast(lower);
    setFuture((current) => {
      const next = lower(current);
      const top = next.at(-1);
      return top && gridUndos > top.gridUndos ? [] : next;
    });
  }, [gridDropped, gridUndos]);
  const record = useCallback((entry: XlsxVisualHistoryDraft) => {
    setPast((current) => [...current, { ...entry, gridUndos: gridUndosRef.current } as XlsxVisualHistoryEntry]);
    setFuture([]);
  }, []);

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

  // The file's own visuals: one entry per drawing anchor.
  useEffect(() => {
    if (!fileVisuals) return;
    removalsRef.current = [];
    // The file's anchors predate the stream already scanned: shift them by it.
    const seeded = applyOverlayShifts(seedFileVisuals(fileVisuals), structuralShiftsOf(streamSeenRef.current.ops), (name) => sheetIdOfRef.current(name));
    setVisuals((current) => [...seeded, ...current.filter((visual) => visual.file === undefined)]);
  }, [fileVisuals]);

  // A save landed: the file deletes it carried renumber the drawing and the
  // visuals it wrote become file visuals, editable through their index.
  useEffect(() => {
    const pending = removalsRef.current;
    removalsRef.current = pending.filter((removal) => !(removal.generation > 0 && removal.generation <= savedGeneration));
    setVisuals((current) => applySavedVisuals(current, pending, savedGeneration).visuals);
    // A save renumbers the drawing: older entries would address stale handles.
    setPast([]);
    setFuture([]);
  }, [savedGeneration]);

  // A recovered draft re-emits its op stream (F4) into the next save, but the
  // overlay state died with the tab: draw the stream's visuals again so they
  // can be seen, moved and deleted. Ids this overlay already held are skipped
  // (a stale stream must not resurrect a local delete).
  const stream = (options.snapshot as { pendingOps?: unknown } | null | undefined)?.pendingOps;
  useEffect(() => {
    if (!Array.isArray(stream)) return;
    // Row/column inserts and deletes appended since the last look move the
    // drawn visuals now, the way the save will write them (UNI-953 r2).
    const keys = streamOpKeys(stream);
    const segment = stream.slice(appendedFrom(streamSeenRef.current.keys, keys));
    streamSeenRef.current = { ops: stream, keys };
    const shifts = structuralShiftsOf(segment);
    if (shifts.length > 0) setVisuals((current) => applyOverlayShifts(current, shifts, sheetIdOf));
    // Moves and deletes of file visuals a recovered draft carries: applied
    // once, onto the file entries, before this tab edits anything itself.
    const fileEdits = fileStreamRef.current === "pending" && fileVisuals ? fileEditsFromStream(stream) : [];
    if (fileVisuals && stream.length > 0) fileStreamRef.current = "done";
    // A recovered edit rides the next save whatever the dirty generation is
    // now, so it counts as covered by any save from here on (at least 1).
    if (fileEdits.length > 0) {
      const stamp = Math.max(generation(), 1);
      const located = fileEdits.flatMap((edit) => {
        const sheetId = sheets.find((sheet) => sheet.name === edit.sheetName)?.id;
        return sheetId === undefined ? [] : [{ ...edit, sheetId }];
      });
      removalsRef.current = [...removalsRef.current, ...located.filter((edit) => edit.remove).map((edit) => ({ sheetId: edit.sheetId, file: edit.file, generation: stamp }))];
      setVisuals((current) => current.flatMap((visual) => {
        const edit = located.find((candidate) => candidate.sheetId === visual.sheetId && candidate.file === visual.file);
        if (!edit) return [visual];
        return edit.remove ? [] : [{ ...visual, anchor: edit.anchor ?? visual.anchor, generation: stamp }];
      }));
    }
    const recovered = visualsFromStream(stream).flatMap((visual) => {
      const sheetId = sheets.find((sheet) => sheet.name === visual.sheetName)?.id;
      return sheetId === undefined || knownIdsRef.current.has(visual.id) ? [] : [{ ...visual, sheetId }];
    });
    if (recovered.length === 0) return;
    const stamp = Math.max(generation(), 1);
    for (const visual of recovered) knownIdsRef.current.add(visual.id);
    setVisuals((current) => [
      ...current,
      ...recovered.map(({ sheetName: _sheetName, ...visual }): XlsxEditorVisual => ({ ...visual, generation: stamp })),
    ]);
  }, [fileVisuals, generation, sheetIdOf, sheets, stream]);

  /** Apply `next` locally, send `op`, and restore this visual's entry from
   *  `previous` if it fails (other visuals keep any later change). */
  const commit = useCallback((previous: readonly XlsxEditorVisual[], next: readonly XlsxEditorVisual[], op: Record<string, unknown>, id: string, onStamp?: (stamp: number) => void) => {
    if (!edit) return;
    fileStreamRef.current = "done";
    setVisuals(next);
    void Promise.resolve(edit([op]))
      .then(() => {
        const stamp = generation();
        onStamp?.(stamp);
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
    const visual: XlsxEditorVisual = { id: nextVisualId(), sheetId: activeSheetId, anchor, ...body, generation: 0 };
    knownIdsRef.current.add(visual.id);
    commit(visuals, [...visuals, visual], setVisualOp(visual, name), visual.id, () => record({ kind: "insert", visual }));
    setSelectedId(visual.id);
  }, [activeSheetId, available, commit, geometry, record, sheetName, visuals]);

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
    if (!measure || !name || visual.fixed || saving) return;
    const anchor = anchorFromBox(measure, visual.sheetId, box);
    if (!anchor) return;
    const moved = { ...visual, anchor };
    commit(visuals, visuals.map((candidate) => (candidate.id === visual.id ? moved : candidate)), moveVisualOp(moved, name), visual.id, () => record({ kind: "move", before: visual, after: moved }));
  }, [commit, geometry, record, saving, sheetName, visuals]);

  const remove = useCallback((visual: XlsxEditorVisual) => {
    const name = sheetName(visual.sheetId);
    if (!name || visual.fixed || saving) return;
    if (selectedId === visual.id) setSelectedId(null);
    const file = visual.file;
    const recordRemoval = file === undefined ? undefined : (stamp: number) => {
      removalsRef.current = [...removalsRef.current, { sheetId: visual.sheetId, file, generation: stamp }];
    };
    commit(visuals, visuals.filter((candidate) => candidate.id !== visual.id), removeVisualOp(visual, name), visual.id, (stamp) => {
      recordRemoval?.(stamp);
      record({ kind: "remove", visual });
    });
  }, [commit, record, saving, selectedId, sheetName, visuals]);

  const step = useCallback((direction: XlsxVisualHistoryDirection) => {
    const entry = (direction === "undo" ? past : future).at(-1);
    if (!entry || !edit || saving || !canEdit) return;
    const name = sheetName(entry.kind === "move" ? entry.after.sheetId : entry.visual.sheetId);
    if (!name) return;
    const { next, op, id } = applyVisualHistory(visuals, entry, direction, name);
    commit(visuals, next, op, id, (stamp) => {
      // A file visual's delete is pending for the next save until it is undone.
      if (entry.kind === "remove" && entry.visual.file !== undefined) {
        const { sheetId, file } = entry.visual;
        const others = removalsRef.current.filter((removal) => !(removal.sheetId === sheetId && removal.file === file));
        removalsRef.current = direction === "undo" ? others : [...others, { sheetId, file, generation: stamp }];
      }
      setPast((current) => (direction === "undo" ? current.slice(0, -1) : [...current, entry]));
      setFuture((current) => (direction === "undo" ? [...current, entry] : current.slice(0, -1)));
    });
  }, [canEdit, commit, edit, future, past, saving, sheetName, visuals]);
  const history = useMemo<XlsxVisualsHistory>(() => {
    const usable = canEdit && typeof edit === "function" && !saving;
    return {
      canUndo: usable && past.length > 0 && (past.at(-1)?.gridUndos ?? 0) >= gridUndos,
      canRedo: usable && future.length > 0 && future.at(-1)?.gridUndos === gridUndos,
      selected: selectedId !== null,
      undo: () => step("undo"),
      redo: () => step("redo"),
    };
  }, [canEdit, edit, future, gridUndos, past, saving, selectedId, step]);

  const measure = geometry();
  const items = activeSheetId === null || !measure
    ? []
    : visuals
        .filter((visual) => visual.sheetId === activeSheetId && visual.kind !== "other")
        .map((visual) => ({ visual, box: boxOfVisual(measure, visual) }));

  const commands = useMemo<XlsxVisualsCommands>(() => ({
    available,
    canInsertChart: available && span !== null && (span.rows > 1 || span.columns > 1),
    insertChart,
    insertShape,
    insertPicture: () => { if (available) pictureInputRef.current?.click(); },
  }), [available, insertChart, insertShape, span]);

  const isCellEditing = useCallback(() => gridRef.current?.isCellEditing?.() ?? null, [gridRef]);
  const overlay = items.length > 0
    ? <XlsxVisualLayer items={items} selectedId={selectedId} readOnly={!canEdit || saving} onSelect={setSelectedId} onMove={move} onRemove={remove} isCellEditing={isCellEditing} />
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

  const getPrintableVisuals = useCallback((sheetId?: string, metricsFor?: (sheetId: string) => XlsxPrintSheetMetrics | null) => {
    const measure = geometry();
    const fallback = (id: string) => (measure ? gridSheetMetrics(measure, id) : null);
    const kindLabel = (kind: XlsxPrintableVisual["kind"]) => (kind === "chart" ? t("office.xlsx.visuals.item.kindChart") : kind === "shape" ? t("office.xlsx.visuals.item.kindShape") : t("office.xlsx.visuals.item.picture"));
    return printableVisuals(visuals, sheets, metricsFor ?? fallback, kindLabel, sheetId);
  }, [geometry, sheets, t, visuals]);

  return { commands, overlay, onViewportChange, dialog, getPrintableVisuals, history, isCellEditing };
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
