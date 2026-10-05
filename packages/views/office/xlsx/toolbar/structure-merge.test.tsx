import { describe, expect, it, vi } from "vitest";
import type { RibbonItem, RibbonSplitItem } from "../../ribbon";
import {
  XLSX_MERGE_ACROSS_COMMAND,
  XLSX_MERGE_ALL_COMMAND,
  XLSX_UNMERGE_COMMAND,
  xlsxMergeRibbonItem,
} from "./structure-merge";
import type { XlsxToolbarGroupProps } from "./types";

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    permissions: {},
    selection: { sheet: "Data", address: "B2", endAddress: "C4" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
}

const executeMock = (props: XlsxToolbarGroupProps) => props.commands!.execute as ReturnType<typeof vi.fn>;
const RANGE = [{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 2 }];

function split(item: RibbonItem): RibbonSplitItem {
  if (item.kind !== "split") throw new Error("expected a split item");
  return item;
}
const entry = (item: RibbonSplitItem, id: string) => item.menu.find((candidate) => candidate.id === id)!;

describe("xlsxMergeRibbonItem", () => {
  it("is an icon split with the three merge commands in its menu", () => {
    const item = split(xlsxMergeRibbonItem(groupProps()));
    expect(item).toMatchObject({ id: "align-merge", size: "icon" });
    expect(item.menu.map((candidate) => candidate.id)).toEqual(["merge-cells", "merge-across", "unmerge-cells"]);
  });

  it("fires the pinned merge and unmerge commands with the selection range", () => {
    const props = groupProps();
    const item = split(xlsxMergeRibbonItem(props));
    const execute = executeMock(props);
    entry(item, "merge-cells").onSelect();
    expect(execute).toHaveBeenCalledWith(XLSX_MERGE_ALL_COMMAND, { selections: RANGE });
    entry(item, "merge-across").onSelect();
    expect(execute).toHaveBeenCalledWith(XLSX_MERGE_ACROSS_COMMAND, { selections: RANGE });
    entry(item, "unmerge-cells").onSelect();
    expect(execute).toHaveBeenCalledWith(XLSX_UNMERGE_COMMAND, { ranges: RANGE });
  });

  it("merge & center merges the selection then centres it", () => {
    const props = groupProps();
    split(xlsxMergeRibbonItem(props)).onExecute();
    expect(executeMock(props).mock.calls).toEqual([
      [XLSX_MERGE_ALL_COMMAND, { selections: RANGE }],
      ["sheet.command.set-horizontal-text-align", { value: 2 }],
    ]);
  });

  it("keeps a one-row multi-column selection mergeable and unmergeable", () => {
    const props = groupProps({ selection: { sheet: "Data", address: "B2", endAddress: "D2" } });
    const item = split(xlsxMergeRibbonItem(props));
    const row = [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 }];
    entry(item, "merge-across").onSelect();
    expect(executeMock(props)).toHaveBeenCalledWith(XLSX_MERGE_ACROSS_COMMAND, { selections: row });
    entry(item, "unmerge-cells").onSelect();
    expect(executeMock(props)).toHaveBeenCalledWith(XLSX_UNMERGE_COMMAND, { ranges: row });
  });

  it("disables merge across on a single-column selection, where each row would merge into itself", () => {
    const props = groupProps({ selection: { sheet: "Data", address: "B2", endAddress: "B4" } });
    const item = split(xlsxMergeRibbonItem(props));
    const across = entry(item, "merge-across");
    expect(across.disabled).toBe(true);
    across.onSelect();
    expect(executeMock(props)).not.toHaveBeenCalled();
    expect(entry(item, "merge-cells").disabled).toBe(false);
    entry(item, "merge-cells").onSelect();
    expect(executeMock(props)).toHaveBeenCalledWith(XLSX_MERGE_ALL_COMMAND, {
      selections: [{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 }],
    });
  });

  it("refuses everything read-only, without a selection, on a single cell or without a commands port", () => {
    for (const overrides of [
      { readOnly: true },
      { selection: null },
      { selection: { sheet: "Data", address: "B2" } },
      { commands: undefined },
    ] as Partial<XlsxToolbarGroupProps>[]) {
      const props = groupProps(overrides);
      const item = split(xlsxMergeRibbonItem(props));
      expect(item.disabled).toBe(true);
      item.onExecute();
      for (const candidate of item.menu) {
        expect(candidate.disabled).toBe(true);
        candidate.onSelect();
      }
      if (props.commands) expect(executeMock(props)).not.toHaveBeenCalled();
    }
  });
});
