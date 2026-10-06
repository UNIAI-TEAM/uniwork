import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XlsxDataValidationDialog } from "./data-validation-dialog";

const range = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };

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

function renderDialog() {
  const execute = vi.fn((_id: string, _params?: unknown) => true);
  const onClose = vi.fn();
  render(<XlsxDataValidationDialog commands={{ execute }} unitId="file-abc" subUnitId="sheet-1" range={range} onClose={onClose} />);
  return { execute, onClose };
}

function pick(labelKey: string, optionKey: string) {
  fireEvent.click(screen.getByRole("combobox", { name: lookup(viLocale, labelKey) as string }));
  // Base UI's Select commits on the pointer sequence; a bare click does not.
  const option = screen.getByRole("option", { name: lookup(viLocale, optionKey) as string });
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("XlsxDataValidationDialog", () => {
  it("shows the A1 range being validated", () => {
    renderDialog();
    expect(screen.getByTestId("xlsx-dv-range")).toHaveTextContent("A1:C4");
  });

  it("applies a list rule with the exact command params and closes", () => {
    const { execute, onClose } = renderDialog();
    type("xlsx-dv-source", "Yes, No");
    type("xlsx-dv-error-title", "Oops");
    type("xlsx-dv-error-message", "Pick one");
    fireEvent.click(screen.getByTestId("xlsx-dv-apply"));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("sheet.command.addDataValidation", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
      rule: {
        uid: expect.stringMatching(/^uw-dv-/),
        type: "list",
        formula1: "Yes,No",
        ranges: [range],
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: 1,
        error: "Pick one",
        errorTitle: "Oops",
        showDropDown: true,
      },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("applies a whole-number between rule with two value inputs", () => {
    const { execute } = renderDialog();
    pick("office.xlsx.dataValidation.dialog.allow", "office.xlsx.dataValidation.types.whole");
    expect(screen.queryByTestId("xlsx-dv-value2")).toBeInTheDocument();
    type("xlsx-dv-value1", "1");
    type("xlsx-dv-value2", "10");
    fireEvent.click(screen.getByTestId("xlsx-dv-apply"));
    expect(execute).toHaveBeenCalledWith(
      "sheet.command.addDataValidation",
      expect.objectContaining({
        rule: expect.objectContaining({ type: "whole", operator: "between", formula1: "1", formula2: "10" }),
      }),
    );
  });

  it("uses a single value for a one-value operator and date inputs for dates", () => {
    const { execute } = renderDialog();
    pick("office.xlsx.dataValidation.dialog.allow", "office.xlsx.dataValidation.types.date");
    pick("office.xlsx.dataValidation.dialog.operator", "office.xlsx.dataValidation.operators.greaterThan");
    expect(screen.queryByTestId("xlsx-dv-value2")).not.toBeInTheDocument();
    expect(screen.getByTestId("xlsx-dv-value1")).toHaveAttribute("type", "date");
    type("xlsx-dv-value1", "2026-01-31");
    fireEvent.click(screen.getByTestId("xlsx-dv-apply"));
    expect(execute).toHaveBeenCalledWith(
      "sheet.command.addDataValidation",
      expect.objectContaining({
        rule: expect.objectContaining({ type: "date", operator: "greaterThan", formula1: "2026-01-31" }),
      }),
    );
  });

  it("shows an inline alert and fires nothing for an invalid rule", () => {
    const { execute, onClose } = renderDialog();
    fireEvent.click(screen.getByTestId("xlsx-dv-apply"));
    expect(screen.getByRole("alert")).toHaveTextContent(lookup(viLocale, "office.xlsx.dataValidation.errors.listEmpty") as string);
    expect(screen.getByTestId("xlsx-dv-source")).toHaveAttribute("aria-invalid", "true");
    pick("office.xlsx.dataValidation.dialog.allow", "office.xlsx.dataValidation.types.decimal");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    type("xlsx-dv-value1", "1");
    type("xlsx-dv-value2", "x");
    fireEvent.click(screen.getByTestId("xlsx-dv-apply"));
    expect(screen.getByRole("alert")).toHaveTextContent(lookup(viLocale, "office.xlsx.dataValidation.errors.numberRequired") as string);
    expect(execute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels without firing", () => {
    const { execute, onClose } = renderDialog();
    fireEvent.click(screen.getByTestId("xlsx-dv-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("ties every field to a label", () => {
    renderDialog();
    expect(screen.getByLabelText(lookup(viLocale, "office.xlsx.dataValidation.dialog.allow") as string)).toBe(screen.getByRole("combobox", { name: lookup(viLocale, "office.xlsx.dataValidation.dialog.allow") as string }));
    expect(screen.getByLabelText(lookup(viLocale, "office.xlsx.dataValidation.dialog.source") as string)).toBe(screen.getByTestId("xlsx-dv-source"));
  });

  it("keeps the dataValidation subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.dataValidation"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
