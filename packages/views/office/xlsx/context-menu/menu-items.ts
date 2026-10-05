// Wave A / A9 (UNI-926): the grid context menu's pure catalog. It maps a
// right-click on a cell/selection to the SAME commands and editor callbacks
// the toolbar groups use - never a second command or save path. Keeping the
// mapping pure lets the tests pin every item's command id and params without a
// renderer, and lets the component stay a thin renderer over this list.
//
// Only commands that persist through seams that exist on the branch today are
// listed: cut/copy/paste, clear content/format, insert/delete row+column (B1),
// merge/unmerge (B2), number format (A2), sort asc/desc (A7), filter (B4),
// find (A4). Cut is the composition of the editor's existing copy callback and
// the allowlisted clear-content command (no new op).

import { XLSX_FILTER_CLEAR_COMMAND, XLSX_FILTER_TOGGLE_COMMAND } from "../filter/filter-commands";
import {
  numberFormatCommandParams,
  selectionFormatCells,
  XLSX_NUMBER_FORMAT_CATEGORIES,
  XLSX_NUMBER_FORMAT_COMMANDS,
} from "../number-format/catalog";
import { sortCommandParams, sortRangeIsSortable, sortWithinOpLimit, type XlsxSortRange } from "../sort/sort-commands";
import { insertCounts, selectionSpan } from "../toolbar/structure-insert";
import {
  XLSX_MERGE_ACROSS_COMMAND,
  XLSX_MERGE_ALL_COMMAND,
  XLSX_UNMERGE_COMMAND,
} from "../toolbar/structure-merge";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxEditorPermissions, XlsxSelection } from "../types";

/** The pinned clear commands the Home-tab clear dropdown dispatches. Repeated
 *  here (same ids, same port) so the menu does not import a toolbar group. */
export const XLSX_CONTEXT_CLEAR_CONTENT_COMMAND = "sheet.command.clear-selection-content";
export const XLSX_CONTEXT_CLEAR_FORMAT_COMMAND = "sheet.command.clear-selection-format";

/** Structure commands, mirroring the Insert-tab group. */
export const XLSX_CONTEXT_INSERT_ROW_BEFORE_COMMAND = "sheet.command.insert-row-before";
export const XLSX_CONTEXT_INSERT_ROW_AFTER_COMMAND = "sheet.command.insert-row-after";
export const XLSX_CONTEXT_INSERT_COL_BEFORE_COMMAND = "sheet.command.insert-col-before";
export const XLSX_CONTEXT_INSERT_COL_AFTER_COMMAND = "sheet.command.insert-col-after";
export const XLSX_CONTEXT_REMOVE_ROW_COMMAND = "sheet.command.remove-row";
export const XLSX_CONTEXT_REMOVE_COL_COMMAND = "sheet.command.remove-col";

/** Editor callbacks the menu may invoke instead of a command. */
export type XlsxContextMenuCallback = "cut" | "copy" | "paste" | "find";

export interface XlsxContextMenuCommandAction {
  readonly kind: "command";
  readonly id: string;
  readonly params?: unknown;
}

export interface XlsxContextMenuCallbackAction {
  readonly kind: "callback";
  readonly callback: XlsxContextMenuCallback;
}

export type XlsxContextMenuAction = XlsxContextMenuCommandAction | XlsxContextMenuCallbackAction;

/** One resolved menu row. Disabled rows are always rendered (never hidden);
 *  `aria-disabled` carries the state, mirroring the toolbar controls. */
export interface XlsxContextMenuEntry {
  readonly id: string;
  readonly labelKey: string;
  readonly disabled: boolean;
  readonly action?: XlsxContextMenuAction;
  /** Present for the number-format submenu. */
  readonly children?: readonly XlsxContextMenuEntry[];
  readonly separatorBefore?: boolean;
}

/** The sort scope the pinned `sheet.command.sort-range` needs: the workbook
 *  unit, the live sheet id and the selection rectangle. Null without a live
 *  grid, which disables the sort items. */
export interface XlsxContextMenuSortScope {
  readonly unitId: string;
  readonly sheetId: string;
  readonly range: XlsxSortRange;
}

/** The slice of editor state the menu's disabled logic reads. It mirrors the
 *  toolbar group props so both surfaces disable on the same conditions. */
export interface XlsxContextMenuState {
  readonly readOnly: boolean;
  readonly selection: XlsxSelection | null;
  readonly canFormat: boolean;
  readonly commands?: XlsxToolbarCommands;
  readonly permissions?: XlsxEditorPermissions;
  /** The editor can cut (copy the selection, then clear its content). */
  readonly canCut: boolean;
  /** The editor can open the find & replace panel. */
  readonly canFind: boolean;
  /** The sort scope for the selection; null without a live grid. */
  readonly sort: XlsxContextMenuSortScope | null;
}

/** The number-format submenu: every preset from the A2 catalog, each applying
 *  through the pinned `numfmt.set.numfmt` command with the same per-cell
 *  params the gallery uses. */
function numberFormatEntries(cells: ReturnType<typeof selectionFormatCells>, blocked: boolean): readonly XlsxContextMenuEntry[] {
  return XLSX_NUMBER_FORMAT_CATEGORIES.flatMap((category) =>
    category.presets.map((preset) => ({
      id: `number-format-${preset.id}`,
      labelKey: preset.labelKey,
      disabled: blocked,
      action: {
        kind: "command" as const,
        id: XLSX_NUMBER_FORMAT_COMMANDS.set,
        params: cells === null ? undefined : numberFormatCommandParams(cells, preset.pattern),
      },
    })),
  );
}

/** Resolves the menu for one right-click. Pure: the component and the tests
 *  both call this, so an item's command id, params and disabled state have one
 *  definition. */
export function buildXlsxContextMenu(state: XlsxContextMenuState): readonly XlsxContextMenuEntry[] {
  const span = selectionSpan(state.selection);
  const range = span === null
    ? null
    : { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn };
  const noCommands = state.commands === undefined;
  // Same counts as the ribbon: a whole-axis selection inserts one line on the
  // other axis. The after items stay count-less: Univer's insert-row-after /
  // insert-col-after ignore params and insert the selection's own span.
  const counts = span === null ? null : insertCounts(span, state.selection?.rangeType);
  const structureBlocked = state.readOnly || noCommands || span === null;
  const mergeBlocked = state.readOnly || noCommands || span === null || (span.rows === 1 && span.columns === 1);
  const mergeAcrossBlocked = mergeBlocked || (span !== null && span.columns === 1);
  const clearBlocked = state.readOnly || !state.canFormat || noCommands || state.selection === null;
  const filterBlocked = state.readOnly || noCommands;
  const findBlocked = state.readOnly || noCommands || !state.canFind;
  const cells = selectionFormatCells(state.selection);
  const numberBlocked = state.readOnly || !state.canFormat || noCommands || cells === null;
  const copyBlocked = state.selection === null || state.permissions?.canCopy === false;
  const pasteBlocked = state.readOnly || state.selection === null || state.permissions?.canPaste === false;
  const cutBlocked = state.readOnly || copyBlocked || noCommands || !state.canCut;
  // The pinned sort is refused over the op budget (mirrors the Data-tab group):
  // a partially sorted sheet would save half-sorted, so it never dispatches.
  const sortScope = state.sort;
  // A sort needs at least two rows and one column, and must fit the op budget;
  // otherwise the item is disabled and its command is never built (the pinned
  // `sortCommandParams` refuses an unsortable range).
  const sortBlocked = state.readOnly || noCommands || state.selection === null || sortScope === null ||
    !sortRangeIsSortable(sortScope.range) || sortWithinOpLimit(sortScope.range) === null;

  const sortEntry = (id: string, direction: "asc" | "desc"): XlsxContextMenuEntry => ({
    id,
    labelKey: `office.xlsx.sort.${direction === "asc" ? "ascending" : "descending"}`,
    disabled: sortBlocked,
    action: sortBlocked || sortScope === null
      ? undefined
      : {
          kind: "command",
          id: "sheet.command.sort-range",
          params: sortCommandParams(sortScope.range, sortScope.range.startColumn, direction, false),
        },
  });

  return [
    { id: "cut", labelKey: "office.xlsx.contextMenu.items.cut", disabled: cutBlocked, action: { kind: "callback", callback: "cut" } },
    { id: "copy", labelKey: "office.xlsx.contextMenu.items.copy", disabled: copyBlocked, action: { kind: "callback", callback: "copy" } },
    { id: "paste", labelKey: "office.xlsx.contextMenu.items.paste", disabled: pasteBlocked, action: { kind: "callback", callback: "paste" } },
    {
      id: "clear-content",
      labelKey: "office.xlsx.contextMenu.items.clearContent",
      disabled: clearBlocked,
      separatorBefore: true,
      action: { kind: "command", id: XLSX_CONTEXT_CLEAR_CONTENT_COMMAND },
    },
    {
      id: "clear-format",
      labelKey: "office.xlsx.contextMenu.items.clearFormat",
      disabled: clearBlocked,
      action: { kind: "command", id: XLSX_CONTEXT_CLEAR_FORMAT_COMMAND },
    },
    {
      id: "insert-row-above",
      labelKey: "office.xlsx.contextMenu.items.insertRowAbove",
      disabled: structureBlocked,
      separatorBefore: true,
      action: { kind: "command", id: XLSX_CONTEXT_INSERT_ROW_BEFORE_COMMAND, params: counts === null ? undefined : { value: counts.rows } },
    },
    {
      id: "insert-row-below",
      labelKey: "office.xlsx.contextMenu.items.insertRowBelow",
      disabled: structureBlocked,
      action: { kind: "command", id: XLSX_CONTEXT_INSERT_ROW_AFTER_COMMAND },
    },
    {
      id: "insert-col-left",
      labelKey: "office.xlsx.contextMenu.items.insertColLeft",
      disabled: structureBlocked,
      action: { kind: "command", id: XLSX_CONTEXT_INSERT_COL_BEFORE_COMMAND, params: counts === null ? undefined : { value: counts.columns } },
    },
    {
      id: "insert-col-right",
      labelKey: "office.xlsx.contextMenu.items.insertColRight",
      disabled: structureBlocked,
      action: { kind: "command", id: XLSX_CONTEXT_INSERT_COL_AFTER_COMMAND },
    },
    {
      id: "delete-rows",
      labelKey: "office.xlsx.contextMenu.items.deleteRows",
      disabled: structureBlocked,
      action: { kind: "command", id: XLSX_CONTEXT_REMOVE_ROW_COMMAND, params: range === null ? undefined : { range } },
    },
    {
      id: "delete-cols",
      labelKey: "office.xlsx.contextMenu.items.deleteColumns",
      disabled: structureBlocked,
      action: { kind: "command", id: XLSX_CONTEXT_REMOVE_COL_COMMAND, params: range === null ? undefined : { range } },
    },
    {
      id: "merge",
      labelKey: "office.xlsx.contextMenu.items.mergeCells",
      disabled: mergeBlocked,
      separatorBefore: true,
      action: { kind: "command", id: XLSX_MERGE_ALL_COMMAND, params: { selections: range === null ? [] : [range] } },
    },
    {
      id: "merge-across",
      labelKey: "office.xlsx.contextMenu.items.mergeAcross",
      disabled: mergeAcrossBlocked,
      action: { kind: "command", id: XLSX_MERGE_ACROSS_COMMAND, params: { selections: range === null ? [] : [range] } },
    },
    {
      id: "unmerge",
      labelKey: "office.xlsx.contextMenu.items.unmergeCells",
      disabled: mergeBlocked,
      action: { kind: "command", id: XLSX_UNMERGE_COMMAND, params: { ranges: range === null ? [] : [range] } },
    },
    {
      id: "number-format",
      labelKey: "office.xlsx.contextMenu.items.numberFormat",
      disabled: numberBlocked,
      separatorBefore: true,
      children: numberFormatEntries(cells, numberBlocked),
    },
    sortEntry("sort-ascending", "asc"),
    sortEntry("sort-descending", "desc"),
    {
      id: "filter-toggle",
      labelKey: "office.xlsx.contextMenu.items.filterToggle",
      disabled: filterBlocked,
      separatorBefore: true,
      action: { kind: "command", id: XLSX_FILTER_TOGGLE_COMMAND },
    },
    {
      id: "filter-clear",
      labelKey: "office.xlsx.contextMenu.items.filterClear",
      disabled: filterBlocked,
      action: { kind: "command", id: XLSX_FILTER_CLEAR_COMMAND },
    },
    {
      id: "find",
      labelKey: "office.xlsx.contextMenu.items.find",
      disabled: findBlocked,
      separatorBefore: true,
      action: { kind: "callback", callback: "find" },
    },
  ];
}