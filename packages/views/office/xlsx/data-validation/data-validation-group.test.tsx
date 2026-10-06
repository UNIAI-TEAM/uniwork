import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { XlsxDataValidationGroup } from "./data-validation-group";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1", endAddress: "C4" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    formatState: null,
    unitId: "file-abc",
    sheetName: "Data",
    resolveSheetId: () => "sheet-1",
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

describe("XlsxDataValidationGroup", () => {
  it("has the group label in both locales", () => {
    for (const locale of [en, viLocale]) {
      expect(typeof lookup(locale, "office.xlsx.dataValidation.groups.data")).toBe("string");
    }
  });

  it("opens the group-owned dialog and fires the add command", () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    render(<XlsxDataValidationGroup {...groupProps({ commands: { execute } })} />);
    const open = screen.getByTestId("xlsx-dv-open");
    expect(open).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(open);
    fireEvent.change(screen.getByTestId("xlsx-dv-source"), { target: { value: "a,b" } });
    fireEvent.click(screen.getByTestId("xlsx-dv-apply"));
    expect(execute).toHaveBeenCalledWith(
      "sheet.command.addDataValidation",
      expect.objectContaining({
        unitId: "file-abc",
        subUnitId: "sheet-1",
        rule: expect.objectContaining({
          type: "list",
          formula1: "a,b",
          ranges: [{ startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 }],
        }),
      }),
    );
    expect(screen.queryByTestId("xlsx-dv-dialog")).not.toBeInTheDocument();
  });

  it("clears validation on the selection with the exact params", () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    render(<XlsxDataValidationGroup {...groupProps({ commands: { execute } })} />);
    expect(screen.getByTestId("xlsx-dv-clear")).toHaveAccessibleName(lookup(viLocale, "office.xlsx.dataValidation.clear") as string);
    fireEvent.click(screen.getByTestId("xlsx-dv-clear"));
    expect(execute).toHaveBeenCalledWith("sheets.command.clear-range-data-validation", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
      ranges: [{ startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 }],
    });
  });

  it("stays focusable but inert when blocked", () => {
    for (const overrides of [
      { commands: undefined },
      { selection: null },
      { unitId: null },
      { sheetName: null },
      { resolveSheetId: () => undefined },
      { readOnly: true },
    ] as Partial<XlsxToolbarGroupProps>[]) {
      const execute = vi.fn(() => true);
      const commands = "commands" in overrides ? overrides.commands : { execute };
      const view = render(<XlsxDataValidationGroup {...groupProps({ ...overrides, commands })} />);
      for (const testId of ["xlsx-dv-open", "xlsx-dv-clear"]) {
        const button = screen.getByTestId(testId);
        expect(button).not.toBeDisabled();
        expect(button).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(button);
      }
      expect(execute).not.toHaveBeenCalled();
      expect(screen.queryByTestId("xlsx-dv-dialog")).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
