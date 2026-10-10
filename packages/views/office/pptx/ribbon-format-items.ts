/**
 * Pure ribbon item builders for the PPTX Home tab (UNI-927 F-01): the Font,
 * Paragraph and Arrange groups. No React, no JSX - each function returns shared
 * `RibbonItem[]` data and the integrator wraps them in `RibbonGroup`s.
 *
 * Every enabled handler turns UI state into one committed `TextEdit` per selected
 * text element through the builders of `text/text-format-model.ts` and hands the
 * whole set to `apply` as ONE batch (W9 review F2: one gesture is one undo step).
 * The builders throw a `PptxEngineError` refusal on input they reject; a refused
 * id is skipped and the first refusal goes to `onRefused` once. A disabled item's
 * handler never calls `apply`.
 */
import {
  TextAlignCenter,
  TextAlignJustify,
  TextAlignStart,
  TextAlignEnd,
  Baseline,
  Bold,
  BringToFront,
  Italic,
  List,
  SendToBack,
  Strikethrough,
  Trash2,
  Underline,
} from "lucide-react";
import type { PptxTextAlign, TextEdit } from "@uniwork/office-engine/pptx";
import { createElement } from "react";
import type { RibbonComboItem, RibbonIcon, RibbonItem, RibbonMenuEntry, RibbonOption } from "../ribbon/types";
import { COMBO_DEFAULT, COMBO_MIN } from "../ribbon/layout";
import { PptxDisabledCombo } from "./ribbon-disabled-combo";
import type { PptxRenderNode, PptxRenderSlide, PptxTextLayout } from "./canvas/render-tree";
import {
  buildAlignEdit,
  buildBulletEdit,
  buildFontFamilyEdit,
  buildFontSizeEdit,
  buildFontToggleEdit,
  buildLineSpacingEdit,
  buildTextColorEdit,
  PPTX_TEXT_BULLET_OPTIONS,
  PPTX_TEXT_FONT_FAMILIES,
  PPTX_TEXT_FONT_SIZE_PT_PRESETS,
  PPTX_TEXT_LINE_SPACING_PCT_PRESETS,
  parsePptxFontSizePt,
  parsePptxLineSpacingPct,
  pptxTextFormatAllowed,
  type PptxTextFontToggle,
} from "./text/text-format-model";
import { buildPptxTextEditBatch } from "./text/text-format-batch";

export interface PptxFormatTarget {
  slideIndex: number;
  elementId: string | null;
  elementType: string | null;
  ids: readonly string[];
  /** Selected ids that accept text formatting, anchor first; defaults to [elementId]. */
  textIds?: readonly string[];
}

export interface PptxTextFormatState {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  align?: PptxTextAlign;
}

export interface PptxTextGroupOptions {
  target: PptxFormatTarget;
  state: PptxTextFormatState;
  /** One batch per gesture: every edit of one click travels in a single call. */
  apply?: (edits: readonly TextEdit[]) => void;
  /** The first builder refusal of a gesture, reported once. */
  onRefused?: (error: unknown) => void;
  onMoreOptions?: () => void;
}

export interface PptxArrangeGroupOptions {
  target: PptxFormatTarget;
  reorder?: (dir: "front" | "back") => void;
  remove?: () => void;
}

const K = "office.pptx.text.format.";
const CM = "office.pptx.context_menu.";

function findNode(nodes: readonly PptxRenderNode[], id: string): PptxRenderNode | null {
  for (const node of nodes) {
    if (node.sourceId === id) return node;
    if (node.type === "group") {
      const hit = findNode(node.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function layoutOf(node: PptxRenderNode): PptxTextLayout | undefined {
  return node.type === "shape" || node.type === "text" ? node.text : undefined;
}

/**
 * Reads the first text run / line of the element whose `sourceId` is
 * `elementId`. Unit conclusion: `PptxViewport.scale` is the EMU->px factor with
 * the 96 dpi baseline included (deck-renderer builds it as
 * `widthPx / (cx / 9525)`), so 1 pt = 96/72 px at scale 1 and
 * `pt = fontSizePx / (scale * 4/3)`. The result is rounded to 0.5 pt. Any
 * autofit `fontScale` is already folded into `fontSizePx` by the builder and is
 * not undone here. Returns `{}` for a null tree/id, an unknown id or an element
 * without text.
 */
export function pptxTextFormatState(rendition: PptxRenderSlide | null, elementId: string | null): PptxTextFormatState {
  if (!rendition || !elementId) return {};
  const node = findNode(rendition.nodes, elementId);
  const layout = node ? layoutOf(node) : undefined;
  const line = layout?.lines.find((l) => l.runs.some((r) => !r.isBullet)) ?? layout?.lines[0];
  const run = line?.runs.find((r) => !r.isBullet) ?? line?.runs[0];
  if (!line || !run) return {};
  const state: PptxTextFormatState = {
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    strike: run.strike === true,
    fontFamily: run.srcFontFamily ?? run.fontFamily,
  };
  const pxPerPt = (rendition.scale > 0 ? rendition.scale : 1) * (96 / 72);
  const pt = Math.round((run.fontSizePx / pxPerPt) * 2) / 2;
  if (Number.isFinite(pt) && pt > 0) state.fontSizePt = pt;
  if (line.align) state.align = line.align;
  return state;
}

/** The tooltip reason that disables a text control, or null when enabled. */
function textReason(o: PptxTextGroupOptions): string | null {
  if (!o.target.elementId) return K + "empty";
  if (!pptxTextFormatAllowed(o.target.elementType)) return K + "unsupported";
  if (!o.apply) return K + "unbound";
  return null;
}

/**
 * Builds `build` for every text-capable selected id (anchor first) and forwards
 * the edits as one batch; a refused id is skipped and reported once.
 */
function send(o: PptxTextGroupOptions, build: (slideIndex: number, elementId: string) => TextEdit): void {
  if (!o.apply || textReason(o) !== null) return;
  const { edits, refusal } = buildPptxTextEditBatch(o.target.elementId, o.target.textIds, (id) => build(o.target.slideIndex, id));
  if (edits.length > 0) o.apply(edits);
  if (refusal !== null) o.onRefused?.(refusal);
}

/**
 * An enabled combo stays a plain `combo`. A disabled one becomes a `custom`
 * item so its reason surfaces (the shared combo control has no tooltip).
 */
function comboItem(reason: string | null, combo: RibbonComboItem): RibbonItem {
  if (!reason) return combo;
  return {
    kind: "custom",
    id: combo.id,
    labelKey: combo.labelKey,
    size: "icon",
    // W9 review F7: RibbonItemView ignores `disabled`/`tooltipKey` on kind "custom";
    // PptxDisabledCombo renders both itself. They stay as metadata so every item of a
    // disabled group reads alike to code that inspects the item list.
    disabled: true,
    tooltipKey: reason,
    // Same estimate the ribbon layout gives a combo, so collapse behaves alike.
    width: Math.max(COMBO_MIN, combo.width ?? COMBO_DEFAULT) + 2,
    render: () =>
      createElement(PptxDisabledCombo, {
        labelKey: combo.labelKey,
        reasonKey: reason,
        width: combo.width,
        value: combo.value,
        options: combo.options,
      }),
  };
}

function disabledFields(reason: string | null): { disabled?: true; tooltipKey?: string } {
  return reason ? { disabled: true, tooltipKey: reason } : {};
}

const TOGGLES: ReadonlyArray<{
  id: string;
  toggle: PptxTextFontToggle;
  icon: RibbonIcon;
  shortcut?: string;
}> = [
  { id: "font-bold", toggle: "bold", icon: Bold, shortcut: "Ctrl+B" },
  { id: "font-italic", toggle: "italic", icon: Italic, shortcut: "Ctrl+I" },
  { id: "font-underline", toggle: "underline", icon: Underline, shortcut: "Ctrl+U" },
  { id: "font-strike", toggle: "strike", icon: Strikethrough },
];

const COLORS: ReadonlyArray<readonly [string, string]> = [
  ["black", "#000000"],
  ["white", "#FFFFFF"],
  ["red", "#C00000"],
  ["orange", "#ED7D31"],
  ["green", "#00B050"],
  ["blue", "#0070C0"],
  ["purple", "#7030A0"],
];

export function pptxFontGroupItems(o: PptxTextGroupOptions): RibbonItem[] {
  const reason = textReason(o);
  const dis = disabledFields(reason);
  const family = o.state.fontFamily;
  const families: RibbonOption[] = PPTX_TEXT_FONT_FAMILIES.map((f) => ({ value: f, label: f }));
  if (family && !families.some((f) => f.value === family)) families.unshift({ value: family, label: family });
  const sizes: RibbonOption[] = PPTX_TEXT_FONT_SIZE_PT_PRESETS.map((n) => ({ value: String(n), label: String(n) }));
  const size = o.state.fontSizePt;
  if (size !== undefined && !sizes.some((s) => s.value === String(size))) sizes.push({ value: String(size), label: String(size) });

  const colorMenu: RibbonMenuEntry[] = COLORS.map(([name, hex]) => ({
    id: "font-color-" + name,
    labelKey: "office.pptx.colors." + name,
    ...(reason ? { disabled: true } : {}),
    onSelect: () => send(o, (s, id) => buildTextColorEdit(s, id, hex)),
  }));
  if (o.onMoreOptions) {
    const more = o.onMoreOptions;
    colorMenu.push({ id: "font-color-more", labelKey: "office.pptx.colors.more", ...(reason ? { disabled: true } : {}), onSelect: () => more() });
  }

  const items: RibbonItem[] = [
    comboItem(reason, {
      kind: "combo",
      id: "font-family",
      labelKey: K + "font_family",
      size: "small",
      width: 140,
      value: family ?? null,
      options: families,
      onChange: (v) => send(o, (s, id) => buildFontFamilyEdit(s, id, v)),
    }),
    comboItem(reason, {
      kind: "combo",
      id: "font-size",
      labelKey: K + "font_size",
      size: "small",
      width: 56,
      value: size === undefined ? null : String(size),
      options: sizes,
      onChange: (v) =>
        send(o, (s, id) => {
          const pt = parsePptxFontSizePt(v);
          if (pt === null) throw new RangeError("font size");
          return buildFontSizeEdit(s, id, pt);
        }),
    }),
  ];
  TOGGLES.forEach((t, i) => {
    const pressed = o.state[t.toggle] === true;
    items.push({
      kind: "toggle",
      id: t.id,
      labelKey: K + "toggle." + t.toggle,
      icon: t.icon,
      size: "icon",
      pressed,
      ...(t.shortcut ? { shortcut: t.shortcut } : {}),
      ...(i === 0 ? { rowBreak: true } : {}),
      ...dis,
      onExecute: () => send(o, (s, id) => buildFontToggleEdit(s, id, t.toggle, !pressed)),
    });
  });
  items.push({
    kind: "dropdown",
    id: "font-color",
    labelKey: K + "text_color",
    icon: Baseline,
    size: "icon",
    menu: colorMenu,
    ...dis,
  });
  return items;
}

const ALIGNS: ReadonlyArray<{ align: PptxTextAlign; icon: RibbonIcon }> = [
  { align: "left", icon: TextAlignStart },
  { align: "center", icon: TextAlignCenter },
  { align: "right", icon: TextAlignEnd },
  { align: "justify", icon: TextAlignJustify },
];

const LINE_SPACING_LABELS: Readonly<Record<number, string>> = { 100: "1.0", 115: "1.15", 150: "1.5", 200: "2.0" };

function spacingLabel(pct: number): string {
  return LINE_SPACING_LABELS[pct] ?? (pct / 100).toFixed(2).replace(/0$/, "");
}

export function pptxParagraphGroupItems(o: PptxTextGroupOptions): RibbonItem[] {
  const reason = textReason(o);
  const dis = disabledFields(reason);
  const items: RibbonItem[] = ALIGNS.map((a, i) => ({
    kind: "toggle",
    id: "align-" + a.align,
    labelKey: K + "align." + a.align,
    icon: a.icon,
    size: "icon",
    pressed: o.state.align === a.align,
    ...(i === 0 ? { rowBreak: true } : {}),
    ...dis,
    onExecute: () => send(o, (s, id) => buildAlignEdit(s, id, a.align)),
  }));
  items.push({
    kind: "dropdown",
    id: "para-bullets",
    labelKey: K + "bullet_label",
    icon: List,
    size: "icon",
    ...dis,
    menu: PPTX_TEXT_BULLET_OPTIONS.map((b) => ({
      id: "para-bullets-" + b,
      labelKey: K + "bullet." + b,
      ...(reason ? { disabled: true } : {}),
      onSelect: () => send(o, (s, id) => buildBulletEdit(s, id, b)),
    })),
  });
  items.push(comboItem(reason, {
    kind: "combo",
    id: "para-line-spacing",
    labelKey: K + "line_spacing",
    size: "small",
    width: 64,
    value: null,
    placeholderKey: K + "line_spacing_unset",
    options: PPTX_TEXT_LINE_SPACING_PCT_PRESETS.map((p) => ({ value: String(p), label: spacingLabel(p) })),
    onChange: (v) =>
      send(o, (s, id) => {
        const pct = parsePptxLineSpacingPct(v);
        if (pct === null) throw new RangeError("line spacing");
        return buildLineSpacingEdit(s, id, pct);
      }),
  }));
  return items;
}

export function pptxArrangeGroupItems(o: PptxArrangeGroupOptions): RibbonItem[] {
  const hasSelection = o.target.ids.length > 0 || o.target.elementId !== null;
  const reasonFor = (bound: boolean, unbound: string): string | null =>
    !hasSelection ? CM + "reason_no_selection" : bound ? null : CM + unbound;
  const reorder = o.reorder;
  const remove = o.remove;
  const front = reasonFor(reorder !== undefined, "reason_reorder_unbound");
  const del = reasonFor(remove !== undefined, "reason_delete_unbound");
  return [
    {
      kind: "button",
      id: "arrange-front",
      labelKey: CM + "bring_to_front",
      icon: BringToFront,
      size: "small",
      ...disabledFields(front),
      onExecute: () => {
        if (!front) reorder?.("front");
      },
    },
    {
      kind: "button",
      id: "arrange-back",
      labelKey: CM + "send_to_back",
      icon: SendToBack,
      size: "small",
      ...disabledFields(front),
      onExecute: () => {
        if (!front) reorder?.("back");
      },
    },
    {
      kind: "button",
      id: "arrange-delete",
      labelKey: CM + "delete",
      icon: Trash2,
      size: "small",
      ...disabledFields(del),
      onExecute: () => {
        if (!del) remove?.();
      },
    },
  ];
}
