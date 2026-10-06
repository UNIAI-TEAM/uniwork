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

/** The slide page is white in both themes (`bg-white` on the canvas page), so the preview
 *  draws in the office page ink tokens, not in the theme's `muted-foreground` (light grey
 *  in dark mode, unreadable on white). Text on a dark solid fill uses the inverse ink. */
const PAGE_INK_TEXT = "fill-office-page-ink";
const PAGE_INK_STROKE = "stroke-office-page-ink-muted";
const ON_DARK_TEXT = "fill-office-page-ink-inverse";

const LABEL_MIN_PX = 10;
const LABEL_MAX_PX = 22;
const STYLED_MIN_PX = 6;

/** Whether a "#RRGGBB" fill is dark enough that the inverse ink reads better on it than the
 *  dark ink (WCAG relative luminance; ~0.28 is where the two contrast equally). */
function isDarkFill(fill: string | null | undefined): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(fill ?? "");
  if (!match) return false;
  const value = parseInt(match[1]!, 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0) < 0.28;
}

function elementNode(element: MasterElementView, scale: number, selected: boolean, t: MasterPreviewInput["t"]): SvgNode {
  const w = Math.max(0, element.box.w * scale);
  const h = Math.max(0, element.box.h * scale);
  const placeholder = element.placeholder !== undefined;
  const name = masterElementName(element, t);
  const label = masterElementSnippet(element) || name;
  const style = element.style;
  // The part's own text colour wins over the page ink; the class is dropped then (a class would beat the fill attribute).
  const inkClass = isDarkFill(element.fill) ? ON_DARK_TEXT : PAGE_INK_TEXT;
  const textClass = style?.color ? undefined : inkClass;
  // Applied size: the engine box space is 960 wide, one point per unit (a 13.33in slide), scaled with the page.
  const fontSize = px(style?.sizePt !== undefined ? Math.max(STYLED_MIN_PX, style.sizePt * scale) : Math.min(LABEL_MAX_PX, Math.max(LABEL_MIN_PX, h * 0.22)));
  const textStyle = {
    "font-weight": style?.bold === undefined ? undefined : style.bold ? "bold" : "normal",
    "font-style": style?.italic === undefined ? undefined : style.italic ? "italic" : "normal",
    fill: style?.color,
  };
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
        class: selected ? "stroke-primary" : PAGE_INK_STROKE,
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
        class: textClass,
        ...textStyle,
        "xml:space": "preserve",
      }, label),
      placeholder && label !== name
        ? svgText("text", { x: 8, y: px(h - 6), "font-size": LABEL_MIN_PX, class: textClass }, name)
        : null,
    ],
  );
}

/** The canvas content for one master/layout part. Pure. */
export function buildMasterPreview({ elements, selectedId, page, t }: MasterPreviewInput): PptxCanvasContent {
  const scale = page.widthPx / MASTER_BOX_SPACE_WIDTH_PX;
  const children = elements.length
    ? elements.map((element) => elementNode(element, scale, element.id === selectedId, t))
    : [svgText("text", { x: px(page.widthPx / 2), y: px(page.heightPx / 2), "text-anchor": "middle", "font-size": 16, class: PAGE_INK_TEXT }, t("masters.elements_empty"))];
  const root = svgEl("g", { "data-pptx-master-preview": "true" }, children);
  return { root, widthPx: page.widthPx, heightPx: page.heightPx };
}
