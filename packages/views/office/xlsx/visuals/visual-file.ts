// UNI-953 X02: charts, pictures and shapes ALREADY IN THE FILE. The render
// model lists each sheet's drawing anchors in document order; the overlay
// holds one entry per anchor (undrawable ones too, so the count stays the
// gateway's) and addresses it by that index (`file`). A save renumbers them
// exactly the way the gateway rewrote the drawing: the anchors it deleted
// leave and the later ones move up, then the session visuals it added are
// appended in insert order. From then on those are file visuals too, so a
// visual stays editable after Save.
import type { XlsxRenderVisual, XlsxVisualShapeType } from "@uniwork/office-engine/xlsx";
import { EMU_PER_PX, boxFromAnchor, type XlsxEditorVisual, type XlsxVisualBox, type XlsxVisualGeometry } from "./visual-model";

/** Presets the shape renderer draws; any other file preset is drawn as a rectangle. */
const DRAWN_SHAPES: readonly string[] = ["rect", "roundRect", "ellipse", "triangle", "rightArrow", "leftArrow", "line"];

/** A file visual delete the next save carries (its edit's dirty generation). */
export interface XlsxPendingFileRemoval {
  readonly sheetId: string;
  readonly file: number;
  readonly generation: number;
}

/** The overlay entries for the file visuals of every sheet. */
export function seedFileVisuals(fileVisuals: Readonly<Record<string, readonly XlsxRenderVisual[]>>): XlsxEditorVisual[] {
  return Object.entries(fileVisuals).flatMap(([sheetId, visuals]) =>
    visuals.map((visual): XlsxEditorVisual => {
      const shape = visual.shape
        ? { ...visual.shape, shapeType: (DRAWN_SHAPES.includes(visual.shape.shapeType) ? visual.shape.shapeType : "rect") as XlsxVisualShapeType }
        : undefined;
      return {
        id: `file-${sheetId}-${visual.index}`,
        sheetId,
        file: visual.index,
        kind: visual.kind,
        anchor: visual.anchor ?? { fromRow: 0, fromColumn: 0, fromRowOffset: 0, fromColumnOffset: 0, toRow: 0, toColumn: 0, toRowOffset: 0, toColumnOffset: 0 },
        ...(visual.editable ? {} : { fixed: true }),
        ...(visual.extent ? { extent: visual.extent } : {}),
        ...(visual.position ? { position: visual.position } : {}),
        ...(visual.chart ? { chart: visual.chart } : {}),
        ...(visual.chartTitle ? { title: visual.chartTitle } : {}),
        ...(shape ? { shape } : {}),
        ...(visual.image ? { image: visual.image } : {}),
        generation: 0,
      };
    }),
  );
}

/** Where a visual sits on screen: its two-cell anchor, or for a oneCell /
 *  absolute anchor its start (cell or sheet origin) plus its EMU size. */
export function boxOfVisual(geometry: XlsxVisualGeometry, visual: XlsxEditorVisual): XlsxVisualBox | null {
  if (visual.extent === undefined) return boxFromAnchor(geometry, visual.sheetId, visual.anchor);
  const position = visual.position;
  const origin = position
    ? geometry.getCellBox(visual.sheetId, 0, 0)
    : geometry.getCellBox(visual.sheetId, visual.anchor.fromRow, visual.anchor.fromColumn);
  if (!origin) return null;
  const px = (emu: number) => (emu / EMU_PER_PX) * origin.zoom;
  const x = origin.x + px(position ? position.x : visual.anchor.fromColumnOffset);
  const y = origin.y + px(position ? position.y : visual.anchor.fromRowOffset);
  return { x, y, width: Math.max(px(visual.extent.cx), 1), height: Math.max(px(visual.extent.cy), 1) };
}

/** True when the save that reached `savedGeneration` carried this edit. */
const covered = (generation: number, savedGeneration: number) => generation > 0 && generation <= savedGeneration;

/**
 * Renumber the overlay after a save landed: per sheet, the file deletes the
 * save carried shift the later anchors up, then the session visuals it wrote
 * take the next indexes in insert order. Returns the new list and the
 * deletes still waiting for a save.
 */
export function applySavedVisuals(
  visuals: readonly XlsxEditorVisual[],
  removals: readonly XlsxPendingFileRemoval[],
  savedGeneration: number,
): { visuals: XlsxEditorVisual[]; removals: XlsxPendingFileRemoval[] } {
  const done = removals.filter((removal) => covered(removal.generation, savedGeneration));
  const written = visuals.filter((visual) => visual.file === undefined && covered(visual.generation, savedGeneration));
  if (done.length === 0 && written.length === 0) return { visuals: [...visuals], removals: [...removals] };
  let next = [...visuals];
  for (const removal of [...done].sort((left, right) => right.file - left.file)) {
    next = next.map((visual) =>
      visual.sheetId === removal.sheetId && visual.file !== undefined && visual.file > removal.file ? { ...visual, file: visual.file - 1 } : visual,
    );
  }
  const counts = new Map<string, number>();
  for (const visual of next) {
    if (visual.file !== undefined) counts.set(visual.sheetId, Math.max(counts.get(visual.sheetId) ?? 0, visual.file + 1));
  }
  const writtenIds = new Set(written.map((visual) => visual.id));
  next = next.map((visual) => {
    if (!writtenIds.has(visual.id)) return visual;
    const index = counts.get(visual.sheetId) ?? 0;
    counts.set(visual.sheetId, index + 1);
    return { ...visual, file: index };
  });
  return { visuals: next, removals: removals.filter((removal) => !covered(removal.generation, savedGeneration)) };
}
