// W-I (UNI-924, amendment R / deadline rule 6): the DOCX contextual tabs.
// Word shows Table Design + Table Layout while the caret/selection is inside a
// table, Picture Format while a picture is selected, and Shape Format while a
// shape or text box is selected. They render AFTER the fixed tabs, accent
// coloured, and only while their object is active (no force switching).
//
// Every command here reuses an existing module - the table command runtime
// (../commands/table.ts), the image editing port (../image/docx-image-commands)
// or the shape command runtime (../commands/shapes.ts) - so no new DocxEdit
// kind and no save-path change is introduced.
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BetweenHorizontalStart,
  Columns3,
  FlipHorizontal2,
  FlipVertical2,
  PaintBucket,
  RotateCcw,
  RotateCw,
  Rows3,
  Table2,
  TableCellsMerge,
  TableCellsSplit,
  TableProperties,
  Trash2,
} from "lucide-react";
import type { RibbonGroup, RibbonItem, RibbonMenuEntry, RibbonTab } from "../../ribbon";
import { isDocxInTable } from "../context-menu/table-actions";
import { getDocxLiveEditor } from "../editor-store";
import { createDocxImageEditing } from "../image/docx-image-commands";
import {
  DOCX_IMAGE_POSITION_PRESETS,
  DOCX_IMAGE_WRAP_OPTIONS,
  type DocxImagePositionH,
  type DocxImagePositionV,
} from "../image/docx-image-model";
import { DOCX_SHAPE_WRAP_OPTIONS, type DocxShapeInfo } from "../shapes/docx-shape-model";
import type { DocxToolbarGroupContext } from "./types";

/** Word theme tints reused by the shading/fill menus (document data, not theme
 * tokens - the same convention as the table shading picker). */
const CONTEXTUAL_FILLS: readonly string[] = ["D9EAF7", "DDEBF7", "E2F0D9", "FFF2CC", "FCE4D6", "E7E6E6", "D9D9D9"];

/** The DOCX protected node kinds the contextual tabs answer to. */
type DocxSelectedNodeKind = "image" | "shape" | null;

/** True when the caret or a whole-table node selection sits inside a table. */
export function isSelectionInTable(editor: Editor | null): boolean {
  return editor !== null && !editor.isDestroyed && isDocxInTable(editor);
}

/** The selected protected node's kind, read from the TipTap node selection. */
export function selectedNodeKind(editor: Editor | null): DocxSelectedNodeKind {
  if (!editor || editor.isDestroyed) return null;
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "docProtected") return null;
  const attrs = selection.node.attrs as Record<string, unknown>;
  if (attrs.blockType === "image") return "image";
  if (Array.isArray(attrs.textboxes) && attrs.textboxes.length > 0) return "shape";
  return null;
}

function positionLabelKey(h: DocxImagePositionH, v: DocxImagePositionV): string {
  const V = v === "top" ? "Top" : v === "center" ? "Center" : "Bottom";
  const H = h === "left" ? "Left" : h === "center" ? "Center" : "Right";
  return `office.docx.image.position.${V}${H}`;
}

/** Run one image-port edit against the live editor; a no-op without one. */
function withImageEditing(run: (editing: ReturnType<typeof createDocxImageEditing>) => void): void {
  const editor = getDocxLiveEditor();
  if (!editor) return;
  run(createDocxImageEditing(() => editor));
}

function tableDesignTab(context: DocxToolbarGroupContext, when: boolean): RibbonTab {
  const commands = context.commands;
  const format = context.format;
  const disabled = context.readOnly || context.saving || !commands;
  const borderEntries: readonly RibbonMenuEntry[] = (
    [
      ["grid", "office.docx.table.bordersGrid"],
      ["outline", "office.docx.table.bordersOutline"],
      ["none", "office.docx.table.bordersNone"],
    ] as const
  ).map(([preset, labelKey]) => ({ id: `table-design-border-${preset}`, labelKey, onSelect: () => commands?.applyTableBorders(preset) }));
  const shadingEntries: readonly RibbonMenuEntry[] = [
    ...CONTEXTUAL_FILLS.map((hex) => ({
      id: `table-design-fill-${hex}`,
      labelKey: "office.docx.toolbar.contextual.colorSwatch",
      onSelect: () => commands?.setCellFill(hex),
    })),
    { id: "table-design-fill-none", labelKey: "office.docx.table.shadingNone", onSelect: () => commands?.setCellFill(null) },
  ];
  const items: readonly RibbonItem[] = [
    {
      kind: "toggle",
      id: "table-design-header-row",
      labelKey: "office.docx.table.headerRow",
      icon: TableProperties,
      size: "small",
      pressed: format?.headerRow === true,
      disabled,
      onExecute: () => commands?.toggleHeaderRow(),
    },
    {
      kind: "toggle",
      id: "table-design-repeat-header",
      labelKey: "office.docx.table.repeatHeaderRows",
      icon: BetweenHorizontalStart,
      size: "small",
      pressed: format?.repeatHeaderRows === true,
      disabled: disabled || format?.canRepeatHeaderRows !== true,
      onExecute: () => commands?.toggleRepeatHeaderRows(),
    },
    { kind: "dropdown", id: "table-design-borders-menu", labelKey: "office.docx.table.borders", icon: Table2, size: "small", disabled, menu: borderEntries },
    { kind: "dropdown", id: "table-design-shading-menu", labelKey: "office.docx.table.shading", icon: PaintBucket, size: "small", disabled, menu: shadingEntries },
  ];
  return {
    id: "table-design",
    labelKey: "office.docx.toolbar.tabTableDesign",
    contextual: { when, accent: "brand" },
    groups: [{ id: "table-design", labelKey: "office.docx.toolbar.contextual.tableHeader", priority: 10, items }],
  };
}

function tableLayoutTab(context: DocxToolbarGroupContext, when: boolean): RibbonTab {
  const commands = context.commands;
  const format = context.format;
  const disabled = context.readOnly || context.saving || !commands;
  const groups: readonly RibbonGroup[] = [
    {
      id: "table-layout-rows",
      labelKey: "office.docx.table.rowsGroup",
      priority: 10,
      items: [
        {
          kind: "dropdown",
          id: "table-layout-rows-menu",
          labelKey: "office.docx.table.rowsGroup",
          icon: Rows3,
          size: "small",
          disabled,
          menu: [
            { id: "table-layout-row-above", labelKey: "office.docx.table.insertRowAbove", onSelect: () => commands?.addRowAbove() },
            { id: "table-layout-row-below", labelKey: "office.docx.table.insertRowBelow", onSelect: () => commands?.addRowBelow() },
            { id: "table-layout-row-delete", labelKey: "office.docx.table.deleteRow", onSelect: () => commands?.deleteRow() },
          ],
        },
      ],
    },
    {
      id: "table-layout-columns",
      labelKey: "office.docx.table.columnsGroup",
      priority: 11,
      items: [
        {
          kind: "dropdown",
          id: "table-layout-columns-menu",
          labelKey: "office.docx.table.columnsGroup",
          icon: Columns3,
          size: "small",
          disabled,
          menu: [
            { id: "table-layout-column-left", labelKey: "office.docx.table.insertColumnLeft", onSelect: () => commands?.addColumnLeft() },
            { id: "table-layout-column-right", labelKey: "office.docx.table.insertColumnRight", onSelect: () => commands?.addColumnRight() },
            { id: "table-layout-column-delete", labelKey: "office.docx.table.deleteColumn", onSelect: () => commands?.deleteColumn() },
          ],
        },
      ],
    },
    {
      id: "table-layout-cells",
      labelKey: "office.docx.toolbar.contextual.tableCells",
      priority: 12,
      items: [
        {
          kind: "button",
          id: "table-layout-merge",
          labelKey: "office.docx.table.mergeCells",
          icon: TableCellsMerge,
          size: "small",
          disabled: disabled || format?.canMergeCells !== true,
          onExecute: () => commands?.mergeCells(),
        },
        {
          kind: "button",
          id: "table-layout-split",
          labelKey: "office.docx.table.splitCell",
          icon: TableCellsSplit,
          size: "small",
          disabled: disabled || format?.canSplitCell !== true,
          onExecute: () => commands?.splitCell(),
        },
        {
          kind: "button",
          id: "table-layout-delete",
          labelKey: "office.docx.table.deleteTable",
          icon: Trash2,
          size: "small",
          disabled,
          onExecute: () => commands?.deleteTable(),
        },
      ],
    },
    {
      id: "table-layout-align",
      labelKey: "office.docx.toolbar.contextual.tableAlign",
      priority: 13,
      items: [
        { kind: "button", id: "table-layout-align-left", labelKey: "office.docx.paragraph.alignLeft", icon: AlignLeft, size: "small", disabled, onExecute: () => commands?.setParagraphAlign("left") },
        { kind: "button", id: "table-layout-align-center", labelKey: "office.docx.paragraph.alignCenter", icon: AlignCenter, size: "small", disabled, onExecute: () => commands?.setParagraphAlign("center") },
        { kind: "button", id: "table-layout-align-right", labelKey: "office.docx.paragraph.alignRight", icon: AlignRight, size: "small", disabled, onExecute: () => commands?.setParagraphAlign("right") },
      ],
    },
  ];
  return {
    id: "table-layout",
    labelKey: "office.docx.toolbar.tabTableLayout",
    contextual: { when, accent: "brand" },
    groups,
  };
}

function pictureFormatTab(context: DocxToolbarGroupContext, when: boolean): RibbonTab {
  const disabled = context.readOnly || context.saving;
  const wrapEntries: readonly RibbonMenuEntry[] = DOCX_IMAGE_WRAP_OPTIONS.map((wrap) => ({
    id: `picture-format-wrap-${wrap ?? "inline"}`,
    labelKey: wrap === null ? "office.docx.image.wrap.inline" : `office.docx.image.wrap.${wrap}`,
    onSelect: () => withImageEditing((editing) => editing.apply({ kind: "wrap", wrap })),
  }));
  const positionEntries: readonly RibbonMenuEntry[] = DOCX_IMAGE_POSITION_PRESETS.map(({ h, v }) => ({
    id: `picture-format-position-${v}-${h}`,
    labelKey: positionLabelKey(h, v),
    onSelect: () => withImageEditing((editing) => editing.apply({ kind: "position", h, v })),
  }));
  const groups: readonly RibbonGroup[] = [
    {
      id: "picture-format-arrange",
      labelKey: "office.docx.image.wrap.label",
      priority: 10,
      items: [{ kind: "dropdown", id: "picture-format-wrap-menu", labelKey: "office.docx.image.wrap.label", icon: Table2, size: "small", disabled, menu: wrapEntries }],
    },
    {
      id: "picture-format-position",
      labelKey: "office.docx.image.position.label",
      priority: 11,
      items: [{ kind: "dropdown", id: "picture-format-position-menu", labelKey: "office.docx.image.position.label", icon: Rows3, size: "small", disabled, menu: positionEntries }],
    },
    {
      id: "picture-format-align",
      labelKey: "office.docx.image.align.label",
      priority: 12,
      items: [
        { kind: "button", id: "picture-format-align-left", labelKey: "office.docx.image.align.left", icon: AlignLeft, size: "small", disabled, onExecute: () => withImageEditing((editing) => editing.apply({ kind: "align", align: "left" })) },
        { kind: "button", id: "picture-format-align-center", labelKey: "office.docx.image.align.center", icon: AlignCenter, size: "small", disabled, onExecute: () => withImageEditing((editing) => editing.apply({ kind: "align", align: "center" })) },
        { kind: "button", id: "picture-format-align-right", labelKey: "office.docx.image.align.right", icon: AlignRight, size: "small", disabled, onExecute: () => withImageEditing((editing) => editing.apply({ kind: "align", align: "right" })) },
      ],
    },
    {
      id: "picture-format-transform",
      labelKey: "office.docx.toolbar.contextual.pictureTransform",
      priority: 13,
      items: [
        { kind: "button", id: "picture-format-rotate-left", labelKey: "office.docx.image.rotate.left", icon: RotateCcw, size: "small", disabled, onExecute: () => withImageEditing((editing) => editing.apply({ kind: "rotate", deg: -90 })) },
        { kind: "button", id: "picture-format-rotate-right", labelKey: "office.docx.image.rotate.right", icon: RotateCw, size: "small", disabled, onExecute: () => withImageEditing((editing) => editing.apply({ kind: "rotate", deg: 90 })) },
        { kind: "button", id: "picture-format-flip-h", labelKey: "office.docx.image.flip.h", icon: FlipHorizontal2, size: "small", disabled, onExecute: () => withImageEditing((editing) => editing.apply({ kind: "flip", flipH: true, flipV: false })) },
        { kind: "button", id: "picture-format-flip-v", labelKey: "office.docx.image.flip.v", icon: FlipVertical2, size: "small", disabled, onExecute: () => withImageEditing((editing) => editing.apply({ kind: "flip", flipH: false, flipV: true })) },
      ],
    },
    {
      id: "picture-format-remove",
      labelKey: "office.docx.image.delete",
      priority: 14,
      items: [{ kind: "button", id: "picture-format-delete", labelKey: "office.docx.image.delete", icon: Trash2, size: "small", disabled, onExecute: () => withImageEditing((editing) => editing.remove()) }],
    },
  ];
  return {
    id: "picture-format",
    labelKey: "office.docx.toolbar.tabPictureFormat",
    contextual: { when, accent: "info" },
    groups,
  };
}

function shapeFormatTab(context: DocxToolbarGroupContext, when: boolean): RibbonTab {
  const commands = context.commands;
  const disabled = context.readOnly || context.saving || !commands;
  const shape: DocxShapeInfo | null = context.format?.docxShape ?? null;
  const fillEntries: readonly RibbonMenuEntry[] = [
    ...CONTEXTUAL_FILLS.map((hex) => ({
      id: `shape-format-fill-${hex}`,
      labelKey: "office.docx.toolbar.contextual.colorSwatch",
      onSelect: () => commands?.applyDocxShapeEdit({ kind: "fill", color: hex }),
    })),
    { id: "shape-format-fill-none", labelKey: "office.docx.shapes.fillNone", onSelect: () => commands?.applyDocxShapeEdit({ kind: "fill", color: null }) },
  ];
  const outlineEntries: readonly RibbonMenuEntry[] = [
    ...CONTEXTUAL_FILLS.map((hex) => ({
      id: `shape-format-outline-${hex}`,
      labelKey: "office.docx.toolbar.contextual.colorSwatch",
      onSelect: () => commands?.applyDocxShapeEdit({ kind: "outline", color: hex }),
    })),
    { id: "shape-format-outline-none", labelKey: "office.docx.shapes.outlineNone", onSelect: () => commands?.applyDocxShapeEdit({ kind: "outline", color: null }) },
  ];
  const wrapEntries: readonly RibbonMenuEntry[] = DOCX_SHAPE_WRAP_OPTIONS.map(({ wrap, labelKey }) => ({
    id: `shape-format-wrap-${wrap}`,
    labelKey,
    onSelect: () =>
      commands?.applyDocxShapeEdit({
        kind: "position",
        wrap,
        offsetXEmu: shape?.offsetXEmu ?? null,
        offsetYEmu: shape?.offsetYEmu ?? null,
      }),
  }));
  const groups: readonly RibbonGroup[] = [
    {
      id: "shape-format-fill",
      labelKey: "office.docx.shapes.fill",
      priority: 10,
      items: [{ kind: "dropdown", id: "shape-format-fill-menu", labelKey: "office.docx.shapes.fill", icon: PaintBucket, size: "small", disabled, menu: fillEntries }],
    },
    {
      id: "shape-format-outline",
      labelKey: "office.docx.shapes.outline",
      priority: 11,
      items: [{ kind: "dropdown", id: "shape-format-outline-menu", labelKey: "office.docx.shapes.outline", icon: Table2, size: "small", disabled, menu: outlineEntries }],
    },
    {
      id: "shape-format-wrap",
      labelKey: "office.docx.shapes.wrap",
      priority: 12,
      items: [{ kind: "dropdown", id: "shape-format-wrap-menu", labelKey: "office.docx.shapes.wrap", icon: Columns3, size: "small", disabled, menu: wrapEntries }],
    },
  ];
  return {
    id: "shape-format",
    labelKey: "office.docx.toolbar.tabShapeFormat",
    contextual: { when, accent: "info" },
    groups,
  };
}

/**
 * The DOCX contextual tabs for one toolbar context. A tab whose object is not
 * active carries `when: false`, so OfficeRibbon simply does not render it - the
 * fixed tabs never move and nothing force-switches. Empty-safe: without a live
 * editor every tab is `when: false`.
 */
export function buildDocxContextualTabs(context: DocxToolbarGroupContext): readonly RibbonTab[] {
  const editor = getDocxLiveEditor();
  const inTable = context.format?.inTable === true || isSelectionInTable(editor);
  const kind = selectedNodeKind(editor);
  return [
    tableDesignTab(context, inTable),
    tableLayoutTab(context, inTable),
    pictureFormatTab(context, kind === "image"),
    shapeFormatTab(context, kind === "shape"),
  ];
}
