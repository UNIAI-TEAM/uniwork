"use client";

// UNI-940 X02 (B8): the DOM layer above the grid canvas that draws the
// charts, pictures and shapes inserted this session. The layer itself lets
// pointer events through to the grid; each visual is a focusable item that
// can be selected, dragged, resized from its corners and deleted (Delete or
// its delete button). Keyboard: Tab reaches each item, arrows move it,
// Shift+arrows resize it, Delete removes it, Escape returns focus to the grid.
// Visuals already in the file are edited the same way; only one whose anchor
// the save path cannot move (oneCell / absolute) stays fixed (UNI-953).
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { keyTypesText, type XlsxCellEditingProbe } from "./key-target";
import { XlsxVisualChartSvg } from "./visual-chart-svg";
import { XlsxVisualShapeSvg } from "./visual-shape-svg";
import { dragBox, nudgeBox, visualKind, type XlsxEditorVisual, type XlsxVisualBox, type XlsxVisualHandle } from "./visual-model";

const HANDLES: readonly XlsxVisualHandle[] = ["nw", "ne", "sw", "se"];
const HANDLE_POSITION: Record<XlsxVisualHandle, string> = {
  nw: "-left-1.5 -top-1.5 cursor-nwse-resize",
  ne: "-right-1.5 -top-1.5 cursor-nesw-resize",
  sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
  se: "-bottom-1.5 -right-1.5 cursor-nwse-resize",
};
/** Keyboard step in container pixels. */
const KEY_STEP = 8;
/** How far above the item the delete button sits (its height plus a gap). */
const DELETE_OFFSET = 36;

export interface XlsxVisualLayerItem {
  readonly visual: XlsxEditorVisual;
  /** Where the visual sits on screen now; null when it cannot be measured. */
  readonly box: XlsxVisualBox | null;
}

export interface XlsxVisualLayerProps {
  items: readonly XlsxVisualLayerItem[];
  selectedId: string | null;
  readOnly: boolean;
  onSelect: (id: string | null) => void;
  /** A drag, resize or keyboard move ended on `box` (container pixels). */
  onMove: (visual: XlsxEditorVisual, box: XlsxVisualBox) => void;
  onRemove: (visual: XlsxEditorVisual) => void;
  /** Escape on a visual hands focus back to the grid through this; without it the layer focuses the grid surface itself. */
  onReturnFocus?: () => void;
  /** The renderer's cell-edit state: Delete in the grid's editor input removes the visual unless a cell edit is open. */
  isCellEditing?: XlsxCellEditingProbe;
}

interface DragState {
  readonly id: string;
  readonly handle: XlsxVisualHandle | null;
  readonly startX: number;
  readonly startY: number;
  readonly start: XlsxVisualBox;
  readonly pointerId: number;
}

const GRID_FOCUS_TARGET = "textarea, [contenteditable=\"true\"], [tabindex]:not([tabindex=\"-1\"])";

/** The grid canvas under the layer: the largest <canvas> in the surface. */
function gridCanvas(layer: HTMLElement | null): HTMLCanvasElement | null {
  const surface = layer?.parentElement;
  if (!surface) return null;
  let best: HTMLCanvasElement | null = null;
  let bestArea = -1;
  for (const canvas of Array.from(surface.querySelectorAll("canvas"))) {
    if (layer.contains(canvas)) continue;
    const rect = canvas.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = canvas;
      bestArea = area;
    }
  }
  return best;
}

function VisualPlaceholder({ title, text }: { title?: string | undefined; text: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1 overflow-hidden border border-dashed border-border bg-muted p-2 text-center text-caption text-muted-foreground">
      {title ? <span className="font-medium text-foreground">{title}</span> : null}
      <span>{text}</span>
    </div>
  );
}

function VisualBody({ visual, box, label }: { visual: XlsxEditorVisual; box: XlsxVisualBox; label: string }) {
  const { t } = useTranslation();
  if (visual.chart) return <XlsxVisualChartSvg chart={visual.chart} width={box.width} height={box.height} label={label} />;
  if (visual.kind === "chart") return <VisualPlaceholder title={visual.title} text={t("office.xlsx.visuals.placeholder.chart")} />;
  if (visual.shape) return <XlsxVisualShapeSvg shape={visual.shape} width={box.width} height={box.height} />;
  if (visual.image) {
    return (
      <img
        alt={label}
        draggable={false}
        className="size-full select-none object-fill"
        src={`data:${visual.image.mediaType};base64,${visual.image.base64}`}
      />
    );
  }
  if (visual.kind === "picture") return <VisualPlaceholder text={t("office.xlsx.visuals.placeholder.picture")} />;
  return null;
}

export function XlsxVisualLayer({ items, selectedId, readOnly, onSelect, onMove, onRemove, onReturnFocus, isCellEditing }: XlsxVisualLayerProps) {
  const { t } = useTranslation();
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<{ id: string; box: XlsxVisualBox } | null>(null);

  // A press anywhere outside an item (the grid, the ribbon) clears the
  // selection, like clicking a cell in Excel.
  useEffect(() => {
    if (selectedId === null) return undefined;
    const doc = layerRef.current?.ownerDocument;
    if (!doc) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && layerRef.current?.contains(target)) return;
      onSelect(null);
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    return () => doc.removeEventListener("pointerdown", onPointerDown, true);
  }, [onSelect, selectedId]);

  // Delete / Backspace removes the selected visual wherever focus is: a press
  // on an item does not focus it (the drag starts first), so the key would
  // otherwise reach the grid and clear cells. The grid's focus target is its
  // contenteditable editor input (review r3 F1): only an open cell edit there
  // keeps the key, as do an input or a dialog; a handled key never reaches the grid.
  const selectedVisual = items.find((item) => item.visual.id === selectedId)?.visual ?? null;
  const removable = selectedVisual !== null && !readOnly && !selectedVisual.fixed;
  useEffect(() => {
    if (!selectedVisual || !removable) return undefined;
    const doc = layerRef.current?.ownerDocument;
    if (!doc) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.key !== "Delete" && event.key !== "Backspace") || event.isComposing || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      // An item (or its delete button) answers its own keys.
      if (target && layerRef.current?.contains(target)) return;
      if (keyTypesText(target, isCellEditing, true)) return;
      event.preventDefault();
      event.stopPropagation();
      onRemove(selectedVisual);
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => doc.removeEventListener("keydown", onKeyDown, true);
  }, [isCellEditing, onRemove, removable, selectedVisual]);

  const labelOf = (visual: XlsxEditorVisual): string => {
    const kind = visualKind(visual);
    if (kind === "chart" && !visual.chart) return t("office.xlsx.visuals.item.fileChart", { title: visual.title ?? "" });
    if (kind === "chart") return t("office.xlsx.visuals.item.chart", { type: t(`office.xlsx.visuals.chartTypesInline.${visual.chart!.chartType}`), title: visual.chart!.title });
    if (kind === "shape") return t("office.xlsx.visuals.item.shape", { type: t(`office.xlsx.visuals.shapeTypes.${visual.shape!.shapeType}`) });
    return t("office.xlsx.visuals.item.picture");
  };

  const editable = (visual: XlsxEditorVisual) => !readOnly && !visual.fixed;
  const lockText = (visual: XlsxEditorVisual) =>
    visual.fixed ? t("office.xlsx.visuals.item.fileReadOnly") : readOnly ? t("office.xlsx.visuals.item.unavailable") : undefined;

  const startDrag = (event: ReactPointerEvent, item: XlsxVisualLayerItem, handle: XlsxVisualHandle | null) => {
    if (event.button !== 0 || !item.box) return;
    event.stopPropagation();
    onSelect(item.visual.id);
    if (!editable(item.visual)) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setDrag({ id: item.visual.id, handle, startX: event.clientX, startY: event.clientY, start: item.box, pointerId: event.pointerId });
  };

  const moveDrag = (event: ReactPointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setPreview({ id: drag.id, box: dragBox(drag.start, drag.handle, event.clientX - drag.startX, event.clientY - drag.startY) });
  };

  const endDrag = (event: ReactPointerEvent, visual: XlsxEditorVisual) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = preview && preview.id === drag.id ? preview.box : null;
    setDrag(null);
    setPreview(null);
    if (moved && (moved.x !== drag.start.x || moved.y !== drag.start.y || moved.width !== drag.start.width || moved.height !== drag.start.height)) {
      onMove(visual, moved);
    }
  };

  // The wheel would stop at the item; hand it to the grid canvas below.
  const forwardWheel = (event: ReactWheelEvent) => {
    const canvas = gridCanvas(layerRef.current);
    if (!canvas) return;
    const { deltaX, deltaY, deltaZ, deltaMode, clientX, clientY, ctrlKey, shiftKey, altKey, metaKey } = event;
    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX, deltaY, deltaZ, deltaMode, clientX, clientY, ctrlKey, shiftKey, altKey, metaKey }));
  };

  const returnFocus = () => {
    if (onReturnFocus) {
      onReturnFocus();
      return;
    }
    const layer = layerRef.current;
    const surface = layer?.parentElement;
    const target = Array.from(surface?.querySelectorAll<HTMLElement>(GRID_FOCUS_TARGET) ?? []).find((el) => !layer?.contains(el));
    (target ?? surface)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, item: XlsxVisualLayerItem) => {
    const { visual, box } = item;
    if (event.key === "Escape") {
      event.preventDefault();
      onSelect(null);
      returnFocus();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      if (editable(visual)) onRemove(visual);
      return;
    }
    if (!box || !editable(visual)) return;
    const next = nudgeBox(box, event.key, event.shiftKey, KEY_STEP);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    onMove(visual, next);
  };

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" data-testid="xlsx-visual-layer">
      {items.map((item) => {
        const { visual } = item;
        const box = preview?.id === visual.id ? preview.box : item.box;
        if (!box) return null;
        const selected = selectedId === visual.id;
        const label = labelOf(visual);
        const locked = !editable(visual);
        return (
          <Fragment key={visual.id}>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={label}
              aria-roledescription={t("office.xlsx.visuals.item.roleDescription")}
              aria-describedby={`xlsx-visual-help-${visual.id}`}
              data-testid={`xlsx-visual-item-${visualKind(visual)}`}
              data-visual-id={visual.id}
              data-selected={selected || undefined}
              title={lockText(visual)}
              className={cn(
                "pointer-events-auto absolute touch-none bg-background",
                locked ? "cursor-default" : "cursor-move",
                selected && "ring-2 ring-primary",
                visualKind(visual) === "chart" && "rounded-sm border border-border text-muted-foreground",
                visualKind(visual) === "shape" && "bg-transparent text-foreground",
              )}
              style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
              onFocus={() => onSelect(visual.id)}
              onPointerDown={(event) => startDrag(event, item, null)}
              onPointerMove={moveDrag}
              onPointerUp={(event) => endDrag(event, visual)}
              onPointerCancel={() => { setDrag(null); setPreview(null); }}
              onKeyDown={(event) => onKeyDown(event, item)}
              onWheel={forwardWheel}
            >
              <span id={`xlsx-visual-help-${visual.id}`} className="sr-only">
                {lockText(visual) ?? t("office.xlsx.visuals.item.keyboardHelp")}
              </span>
              <VisualBody visual={visual} box={box} label={label} />
              {selected && !locked ? (
                <>
                  {HANDLES.map((handle) => (
                    <span
                      key={handle}
                      aria-hidden="true"
                      data-testid={`xlsx-visual-handle-${handle}`}
                      className={cn("absolute size-3 rounded-full border border-primary bg-background", HANDLE_POSITION[handle])}
                      onPointerDown={(event) => startDrag(event, item, handle)}
                      onPointerMove={(event) => { event.stopPropagation(); moveDrag(event); }}
                      onPointerUp={(event) => { event.stopPropagation(); endDrag(event, visual); }}
                    />
                  ))}
                </>
              ) : null}
            </div>
            {/* The delete button is the item's sibling, not its child: a control
                nested in a role=button item is flattened by screen readers. It
                sits above the item's right edge, or inside it near the top of
                the layer, where the layer's overflow-hidden would clip it. */}
            {selected && !locked ? (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="pointer-events-auto absolute -translate-x-full bg-background"
                style={{ left: box.x + box.width, top: box.y < DELETE_OFFSET ? box.y + 4 : box.y - DELETE_OFFSET }}
                aria-label={t("office.xlsx.visuals.item.delete", { name: label })}
                title={t("office.xlsx.visuals.item.delete", { name: label })}
                data-testid="xlsx-visual-delete"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onRemove(visual)}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
