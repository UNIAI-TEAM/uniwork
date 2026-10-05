import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxTableGroup } from "./table-group";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1", endAddress: "B5" },
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

describe("XlsxTableGroup", () => {
  const table = (sheet: string, name: string) => ({ sheet, name, range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 } });

  it("shows the next free default name instead of an empty field", () => {
    const view = render(<XlsxTableGroup {...groupProps()} />);
    expect(screen.getByTestId("xlsx-table-name")).toHaveValue("Table1");
    view.unmount();
    render(<XlsxTableGroup {...groupProps({ tables: [table("Data", "Table1"), table("Other", "Table2")] })} />);
    expect(screen.getByTestId("xlsx-table-name")).toHaveValue("Table3");
  });

  it("creates a table over the selection's range under the field's name", () => {
    const execute = vi.fn(() => true);
    render(<XlsxTableGroup {...groupProps({ commands: { execute } })} />);
    expect(screen.getByTestId("xlsx-table-create")).toHaveAccessibleName(lookup(viLocale, "office.xlsx.table.create"));
    fireEvent.click(screen.getByTestId("xlsx-table-create"));
    expect(execute).toHaveBeenCalledWith("sheet.command.add-table", {
      range: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 },
      name: "Table1",
    });
  });

  it("uses a typed name and refuses an invalid or taken one", () => {
    const execute = vi.fn(() => true);
    render(<XlsxTableGroup {...groupProps({ commands: { execute }, tables: [table("Data", "Sales")] })} />);
    const field = screen.getByTestId("xlsx-table-name");
    fireEvent.change(field, { target: { value: "Budget" } });
    fireEvent.click(screen.getByTestId("xlsx-table-create"));
    expect(execute).toHaveBeenLastCalledWith("sheet.command.add-table", expect.objectContaining({ name: "Budget" }));
    for (const bad of ["1 bad", "sales", ""]) {
      fireEvent.change(field, { target: { value: bad } });
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByTestId("xlsx-table-create")).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(screen.getByTestId("xlsx-table-create"));
    }
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("offers no remove control here (Convert to range lives on Table Design)", () => {
    render(<XlsxTableGroup {...groupProps()} />);
    expect(screen.queryByTestId("xlsx-table-remove")).not.toBeInTheDocument();
  });

  it("stays inert without a selection, a commands port or edit rights", () => {
    for (const overrides of [{ selection: null }, { commands: undefined }, { readOnly: true }] as Partial<XlsxToolbarGroupProps>[]) {
      const execute = vi.fn(() => true);
      const commands = "commands" in overrides ? overrides.commands : { execute };
      const view = render(<XlsxTableGroup {...groupProps({ ...overrides, commands })} />);
      fireEvent.click(screen.getByTestId("xlsx-table-create"));
      expect(execute).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("keeps the table subtree in vi/en key parity", () => {
    const stringPaths = (dictionary: unknown): string[] => {
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
    };
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.table"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
