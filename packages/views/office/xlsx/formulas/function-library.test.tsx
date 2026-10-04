import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxSelection } from "../types";
import { functionInsertParams, XlsxFunctionLibraryDialog, type XlsxFunctionLibraryDialogProps } from "./function-library";
import { XLSX_FUNCTIONS } from "./function-catalog";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function text(key: string): string {
  const value = lookup(viLocale, key);
  if (typeof value !== "string") throw new Error(`missing vi locale key ${key}`);
  return value;
}

const SHA = "c".repeat(64);
const selection: XlsxSelection = { sheet: "Data", address: "B3" };

function renderDialog(overrides: Partial<XlsxFunctionLibraryDialogProps> = {}) {
  const execute = vi.fn((_id: string, _params?: unknown) => true);
  const commands: XlsxToolbarCommands = { execute };
  const onClose = vi.fn();
  const props: XlsxFunctionLibraryDialogProps = {
    selection,
    unitId: `file-${SHA}`,
    sheetId: "sheet-1",
    commands,
    onClose,
    ...overrides,
  };
  render(<XlsxFunctionLibraryDialog {...props} />);
  return { execute, onClose };
}

describe("functionInsertParams", () => {
  it("builds the allowlisted set-range-values payload with the =NAME( formula", () => {
    expect(functionInsertParams("file-abc", "sheet-1", 2, 1, "sum")).toEqual({
      unitId: "file-abc",
      subUnitId: "sheet-1",
      value: { "2": { "1": { f: "=SUM(" } } },
    });
  });
});

describe("XlsxFunctionLibraryDialog", () => {
  it("lists the catalog and filters it by name as the user types", () => {
    renderDialog();
    expect(screen.getByTestId("xlsx-function-library")).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBe(XLSX_FUNCTIONS.length);
    fireEvent.change(screen.getByTestId("xlsx-function-search"), { target: { value: "vlook" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("VLOOKUP"),
    ]);
    fireEvent.change(screen.getByTestId("xlsx-function-search"), { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByTestId("xlsx-function-no-match")).toHaveTextContent(text("office.xlsx.formulas.library.noMatch"));
  });

  it("inserts =NAME( at the active cell through the command port and closes", () => {
    const { execute, onClose } = renderDialog();
    fireEvent.click(screen.getByTestId("xlsx-function-SUMIF"));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { "2": { "1": { f: "=SUMIF(" } } },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports a refused command and keeps the dialog open", () => {
    const { execute, onClose } = renderDialog();
    execute.mockReturnValue(false);
    fireEvent.click(screen.getByTestId("xlsx-function-AVERAGE"));
    expect(screen.getByTestId("xlsx-function-error")).toHaveTextContent(text("office.xlsx.formulas.library.insertFailed"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays inert without a command port, a target or edit rights", () => {
    for (const overrides of [
      { commands: undefined },
      { sheetId: null },
      { unitId: null },
      { selection: null },
      { readOnly: true },
    ] as Partial<XlsxFunctionLibraryDialogProps>[]) {
      const execute = vi.fn(() => true);
      const { unmount } = render(
        <XlsxFunctionLibraryDialog
          selection={selection}
          unitId={`file-${SHA}`}
          sheetId="sheet-1"
          commands={{ execute }}
          onClose={vi.fn()}
          {...overrides}
        />,
      );
      fireEvent.click(screen.getByTestId("xlsx-function-SUM"));
      expect(execute).not.toHaveBeenCalled();
      expect(screen.getByTestId("xlsx-function-blocked")).toHaveTextContent(text("office.xlsx.formulas.library.noTarget"));
      expect(screen.getByTestId("xlsx-function-SUM")).toHaveAttribute("aria-disabled", "true");
      unmount();
    }
  });

  it("keeps the formulas subtree in vi/en key parity", () => {
    for (const key of ["office.xlsx.formulas.library.title", "office.xlsx.formulas.library.open"]) {
      expect(typeof lookup(en, key)).toBe("string");
      expect(typeof lookup(viLocale, key)).toBe("string");
    }
  });
});
