/**
 * Canvas preview of the open master/layout part (UNI-939 visual fix, MAJOR-2).
 *
 * While the master view is open the canvas shows the selected part instead of
 * a deck slide, so adding, moving, filling or removing an element gives visual
 * feedback. The panel reads only `MasterElementView` (box, solid fill, text,
 * placeholder slot), not the vendored render tree, so this is a labelled
 * wireframe drawn through the canvas `SvgNode` emitter: each element is its box
 * (solid fill when it has one, dashed outline for a placeholder) with its text,
 * or its localized slot name when it has none. Backgrounds, theme fonts,
 * gradients and pictures are not drawn. Read-only: edits stay in the pane.
 */
import type { PptxCanvasContent } from "../canvas/pptx-canvas-surface";
import { px, svgEl, svgText, type SvgNode } from "../canvas/svg-node";
import { masterElementName, masterElementSnippet } from "./masters-labels";
import type { MasterElementView } from "./masters-model";

/** The px space `MasterElementView.box` is reported in: the engine session's
 *  default fit width (office-engine model.ts DEFAULT_FIT_WIDTH_PX). */
export const MASTER_BOX_SPACE_WIDTH_PX = 960;

export interface MasterPreviewInput {
  elements: readonly MasterElementView[];
  selectedId: string | null;
  /** The slide page in canvas px; the boxes are scaled onto it. */
  page: { widthPx: number; heightPx: number };
  t: (key: string) => string;
}

const LABEL_MIN_PX = 10;
const LABEL_MAX_PX = 22;

function elementNode(element: MasterElementView, scale: number, selected: boolean, t: MasterPreviewInput["t"]): SvgNode {
  const w = Math.max(0, element.box.w * scale);
  const h = Math.max(0, element.box.h * scale);
  const placeholder = element.placeholder !== undefined;
  const name = masterElementName(element, t);
  const label = masterElementSnippet(element) || name;
  const fontSize = px(Math.min(LABEL_MAX_PX, Math.max(LABEL_MIN_PX, h * 0.22)));
  return svgEl(
    "g",
    {
      transform: `translate(${px(element.box.x * scale)} ${px(element.box.y * scale)})`,
      "data-master-element-id": element.id,
      "data-selected": selected ? "true" : undefined,
    },
    [
      svgEl("rect", {
        x: 0,
        y: 0,
        width: px(w),
        height: px(h),
        fill: element.fill ?? "none",
        class: selected ? "stroke-primary" : "stroke-muted-foreground",
        stroke: "currentColor",
        "stroke-width": selected ? 2 : 1,
        "stroke-dasharray": placeholder && !selected ? "6 4" : undefined,
        "vector-effect": "non-scaling-stroke",
      }),
      svgText("text", {
        x: 8,
        y: px(Math.min(h / 2, fontSize + 6)),
        "dominant-baseline": "middle",
        "font-size": fontSize,
        class: "fill-muted-foreground",
        "xml:space": "preserve",
      }, label),
      placeholder && label !== name
        ? svgText("text", { x: 8, y: px(h - 6), "font-size": LABEL_MIN_PX, class: "fill-muted-foreground" }, name)
        : null,
    ],
  );
}

/** The canvas content for one master/layout part. Pure. */
export function buildMasterPreview({ elements, selectedId, page, t }: MasterPreviewInput): PptxCanvasContent {
  const scale = page.widthPx / MASTER_BOX_SPACE_WIDTH_PX;
  const children = elements.length
    ? elements.map((element) => elementNode(element, scale, element.id === selectedId, t))
    : [svgText("text", { x: px(page.widthPx / 2), y: px(page.heightPx / 2), "text-anchor": "middle", "font-size": 16, class: "fill-muted-foreground" }, t("masters.elements_empty"))];
  const root = svgEl("g", { "data-pptx-master-preview": "true" }, children);
  return { root, widthPx: page.widthPx, heightPx: page.heightPx };
}
