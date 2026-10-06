import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarCommands } from "../toolbar/types";
import { XLSX_RANGE_TYPE } from "../selection-mapping";
import { buildXlsxContextMenu, type XlsxContextMenuEntry, type XlsxContextMenuState } from "./menu-items";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function stringPaths(dictionary: unknown): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") paths.push(path);
      else walk(value, path);
    }
  };
  walk(dictionary, "");
  return paths.sort();
}

function state(overrides: Partial<XlsxContextMenuState> = {}): XlsxContextMenuState {
  const commands: XlsxToolbarCommands = { execute: vi.fn(() => true) };
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "B2", endAddress: "C3" },
    canFormat: true,
    commands,
    permissions: { canCopy: true, canPaste: true },
    canCut: true,
    canFind: true,
    sort: { unitId: "file-x", sheetId: "sh1", range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } },
    ...overrides,
  };
}

function find(entries: readonly XlsxContextMenuEntry[], id: string): XlsxContextMenuEntry {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`missing menu entry ${id}`);
  return entry;
}

describe("buildXlsxContextMenu", () => {
  it("maps each item to the toolbar's command id and params", () => {
    const entries = buildXlsxContextMenu(state());
    expect(find(entries, "clear-content").action).toEqual({ kind: "command", id: "sheet.command.clear-selection-content" });
    expect(find(entries, "clear-format").action).toEqual({ kind: "command", id: "sheet.command.clear-selection-format" });
    expect(find(entries, "insert-row-above").action).toEqual({ kind: "command", id: "sheet.command.insert-row-before", params: { value: 2 } });
    expect(find(entries, "insert-row-below").action).toEqual({ kind: "command", id: "sheet.command.insert-multi-rows-after", params: { value: 2 } });
    expect(find(entries, "insert-col-left").action).toEqual({ kind: "command", id: "sheet.command.insert-col-before", params: { value: 2 } });
    expect(find(entries, "insert-col-right").action).toEqual({ kind: "command", id: "sheet.command.insert-multi-cols-right", params: { value: 2 } });
    const range = { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 };
    expect(find(entries, "delete-rows").action).toEqual({ kind: "command", id: "sheet.command.remove-row", params: { range } });
    expect(find(entries, "delete-cols").action).toEqual({ kind: "command", id: "sheet.command.remove-col", params: { range } });
    expect(find(entries, "merge").action).toEqual({ kind: "command", id: "sheet.command.add-worksheet-merge-all", params: { selections: [range] } });
    expect(find(entries, "merge-across").action).toEqual({ kind: "command", id: "sheet.command.add-worksheet-merge-horizontal", params: { selections: [range] } });
    expect(find(entries, "unmerge").action).toEqual({ kind: "command", id: "sheet.command.remove-worksheet-merge", params: { ranges: [range] } });
    expect(find(entries, "filter-toggle").action).toEqual({ kind: "command", id: "sheet.command.smart-toggle-filter" });
    expect(find(entries, "filter-clear").action).toEqual({ kind: "command", id: "sheet.command.clear-filter-criteria" });
  });

  it("applies the ribbon insert-count policy to the before and after items", () => {
    const params = (selection: XlsxContextMenuState["selection"], id: string) => {
      const action = find(buildXlsxContextMenu(state({ selection })), id).action;
      return action?.kind === "command" ? action.params : undefined;
    };
    // Whole columns B:C: Insert row above is one row, not the 1000-row span.
    const columns = { sheet: "Data", address: "B1", endAddress: "C1000", rangeType: XLSX_RANGE_TYPE.COLUMN };
    expect(params(columns, "insert-row-above")).toEqual({ value: 1 });
    expect(params(columns, "insert-col-left")).toEqual({ value: 2 });
    // Whole rows 2:3.
    const rows = { sheet: "Data", address: "A2", endAddress: "Z3", rangeType: XLSX_RANGE_TYPE.ROW };
    expect(params(rows, "insert-row-above")).toEqual({ value: 2 });
    expect(params(rows, "insert-col-left")).toEqual({ value: 1 });
    // The whole sheet inserts one of each.
    const all = { sheet: "Data", address: "A1", endAddress: "Z1000", rangeType: XLSX_RANGE_TYPE.ALL };
    expect(params(all, "insert-row-above")).toEqual({ value: 1 });
    expect(params(all, "insert-col-left")).toEqual({ value: 1 });
    // An explicit wide range keeps its span.
    const wide = { sheet: "Data", address: "A1", endAddress: "Z5", rangeType: XLSX_RANGE_TYPE.NORMAL };
    expect(params(wide, "insert-col-left")).toEqual({ value: 26 });
    // The after items follow the same counts (the multi-after commands read them).
    expect(params(columns, "insert-row-below")).toEqual({ value: 1 });
    expect(params(columns, "insert-col-right")).toEqual({ value: 2 });
    expect(params(rows, "insert-row-below")).toEqual({ value: 2 });
    expect(params(rows, "insert-col-right")).toEqual({ value: 1 });
    expect(params(wide, "insert-col-right")).toEqual({ value: 26 });
  });

  it("maps cut/copy/paste/find to editor callbacks, never a command", () => {
    const entries = buildXlsxContextMenu(state());
    for (const [id, callback] of [["cut", "cut"], ["copy", "copy"], ["paste", "paste"], ["find", "find"]] as const) {
      expect(find(entries, id).action).toEqual({ kind: "callback", callback });
    }
  });

  it("maps the number-format submenu to the pinned numfmt command per preset", () => {
    const entries = buildXlsxContextMenu(state());
    const submenu = find(entries, "number-format");
    expect(submenu.children?.length).toBeGreaterThan(0);
    for (const child of submenu.children ?? []) {
      expect(child.action?.kind).toBe("command");
      if (child.action?.kind === "command") {
        expect(child.action.id).toBe("sheet.command.numfmt.set.numfmt");
        expect(child.action.params).toMatchObject({ values: expect.any(Array) });
      }
    }
  });

  it("maps the sort items to the pinned sort command with the selection's first column", () => {
    const entries = buildXlsxContextMenu(state());
    const asc = find(entries, "sort-ascending");
    expect(asc.action?.kind).toBe("command");
    if (asc.action?.kind === "command") {
      expect(asc.action.id).toBe("sheet.command.sort-range");
      expect(asc.action.params).toMatchObject({
        range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 },
        orderRules: [{ type: "asc", colIndex: 1 }],
        hasTitle: false,
      });
    }
    const desc = find(entries, "sort-descending");
    if (desc.action?.kind === "command") {
      expect(desc.action.params).toMatchObject({ orderRules: [{ type: "desc", colIndex: 1 }] });
    }
  });

  it("disables every editing item when read-only, but keeps copy (and nothing is hidden)", () => {
    const ids = buildXlsxContextMenu(state()).map((entry) => entry.id);
    const entries = buildXlsxContextMenu(state({ readOnly: true }));
    expect(entries.map((entry) => entry.id)).toEqual(ids);
    for (const entry of entries) {
      const expected = entry.id === "copy" ? false : true;
      expect(entry.disabled, entry.id).toBe(expected);
      for (const child of entry.children ?? []) expect(child.disabled, child.id).toBe(true);
    }
  });

  it("disables the renderer commands when the command port is missing", () => {
    const entries = buildXlsxContextMenu(state({ commands: undefined }));
    for (const id of ["clear-content", "insert-row-above", "merge", "filter-toggle", "sort-ascending"]) {
      expect(find(entries, id).disabled, id).toBe(true);
    }
    // Copy is a clipboard read, not a command, so it stays enabled with a selection.
    expect(find(entries, "copy").disabled).toBe(false);
  });

  it("disables with no selection and keeps merge disabled for a single cell", () => {
    const none = buildXlsxContextMenu(state({ selection: null }));
    for (const id of ["clear-content", "insert-row-above", "delete-rows", "merge", "unmerge", "sort-ascending"]) {
      expect(find(none, id).disabled, id).toBe(true);
    }
    const single = buildXlsxContextMenu(state({ selection: { sheet: "Data", address: "A1" } }));
    expect(find(single, "merge").disabled).toBe(true);
    expect(find(single, "unmerge").disabled).toBe(true);
    // Structure commands stay usable on a single cell.
    expect(find(single, "insert-row-above").disabled).toBe(false);
  });

  it("disables merge-across on a single-column selection only", () => {
    const oneColumn = buildXlsxContextMenu(state({ selection: { sheet: "Data", address: "A1", endAddress: "A3" } }));
    expect(find(oneColumn, "merge-across").disabled).toBe(true);
    expect(find(oneColumn, "merge").disabled).toBe(false);
  });

  it("disables copy/paste on permissions and paste on read-only", () => {
    const noCopy = buildXlsxContextMenu(state({ permissions: { canCopy: false } }));
    expect(find(noCopy, "copy").disabled).toBe(true);
    expect(find(noCopy, "cut").disabled).toBe(true);
    const noPaste = buildXlsxContextMenu(state({ permissions: { canPaste: false } }));
    expect(find(noPaste, "paste").disabled).toBe(true);
  });

  it("disables sort without a live grid scope", () => {
    const entries = buildXlsxContextMenu(state({ sort: null }));
    expect(find(entries, "sort-ascending").disabled).toBe(true);
    expect(find(entries, "sort-descending").disabled).toBe(true);
  });

  it("refuses a sort that would exceed the op budget", () => {
    const entries = buildXlsxContextMenu(state({ sort: { unitId: "file-x", sheetId: "sh1", range: { startRow: 0, endRow: 200, startColumn: 0, endColumn: 200 } } }));
    expect(find(entries, "sort-ascending").disabled).toBe(true);
  });

  it("disables find without a mounted grid", () => {
    expect(find(buildXlsxContextMenu(state({ canFind: false })), "find").disabled).toBe(true);
  });

  it("labels every item in both locales", () => {
    const entries = buildXlsxContextMenu(state());
    const all = entries.flatMap((entry) => [entry, ...(entry.children ?? [])]);
    for (const entry of all) {
      for (const locale of [en, viLocale]) {
        expect(typeof lookup(locale, entry.labelKey), entry.labelKey).toBe("string");
      }
    }
  });

  it("keeps the office.xlsx.contextMenu subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.contextMenu"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});