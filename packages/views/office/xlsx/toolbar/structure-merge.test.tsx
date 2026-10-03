import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  XLSX_MERGE_ACROSS_COMMAND,
  XLSX_MERGE_ALL_COMMAND,
  XLSX_UNMERGE_COMMAND,
  XlsxStructureMergeGroup,
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

describe("XlsxStructureMergeGroup", () => {
  it("fires the pinned merge and unmerge commands with the selection range", () => {
    const props = groupProps();
    render(<XlsxStructureMergeGroup {...props} />);
    const execute = executeMock(props);
    fireEvent.click(screen.getByRole("button", { name: "Merge cells" }));
    expect(execute).toHaveBeenCalledWith(XLSX_MERGE_ALL_COMMAND, { selections: RANGE });
    fireEvent.click(screen.getByRole("button", { name: "Merge across" }));
    expect(execute).toHaveBeenCalledWith(XLSX_MERGE_ACROSS_COMMAND, { selections: RANGE });
    fireEvent.click(screen.getByRole("button", { name: "Unmerge cells" }));
    expect(execute).toHaveBeenCalledWith(XLSX_UNMERGE_COMMAND, { ranges: RANGE });
  });

  it("keeps a one-row multi-column selection mergeable and unmergeable", () => {
    const props = groupProps({ selection: { sheet: "Data", address: "B2", endAddress: "D2" } });
    render(<XlsxStructureMergeGroup {...props} />);
    const execute = executeMock(props);
    fireEvent.click(screen.getByRole("button", { name: "Merge across" }));
    expect(execute).toHaveBeenCalledWith(XLSX_MERGE_ACROSS_COMMAND, {
      selections: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Unmerge cells" }));
    expect(execute).toHaveBeenCalledWith(XLSX_UNMERGE_COMMAND, {
      ranges: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 }],
    });
  });

  it("disables merge across on a single-column selection, where each row would merge into itself", () => {
    const props = groupProps({ selection: { sheet: "Data", address: "B2", endAddress: "B4" } });
    render(<XlsxStructureMergeGroup {...props} />);
    const execute = executeMock(props);
    const across = screen.getByRole("button", { name: "Merge across" });
    expect(across).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(across);
    expect(execute).not.toHaveBeenCalled();
    // Merge cells and unmerge still act on the column span.
    fireEvent.click(screen.getByRole("button", { name: "Merge cells" }));
    expect(execute).toHaveBeenCalledWith(XLSX_MERGE_ALL_COMMAND, {
      selections: [{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Unmerge cells" }));
    expect(execute).toHaveBeenCalledWith(XLSX_UNMERGE_COMMAND, {
      ranges: [{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 }],
    });
  });

  it("refuses clicks in a read-only mount", () => {
    const props = groupProps({ readOnly: true });
    render(<XlsxStructureMergeGroup {...props} />);
    for (const name of ["Merge cells", "Merge across", "Unmerge cells"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
    }
    expect(executeMock(props)).not.toHaveBeenCalled();
  });

  it("disables every control without a selection, with a single cell, or without a commands port", () => {
    for (const overrides of [
      { selection: null },
      { selection: { sheet: "Data", address: "B2" } },
      { commands: undefined },
    ] as Partial<XlsxToolbarGroupProps>[]) {
      const props = groupProps(overrides);
      const view = render(<XlsxStructureMergeGroup {...props} />);
      for (const button of view.container.querySelectorAll("button")) {
        expect(button.getAttribute("aria-disabled")).toBe("true");
      }
      if (props.commands) {
        fireEvent.click(view.getByRole("button", { name: "Merge cells" }));
        expect(executeMock(props)).not.toHaveBeenCalled();
      }
      view.unmount();
    }
  });
});
