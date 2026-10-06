import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxLiveRule, XlsxToolbarGroupProps } from "../toolbar/types";
import { XlsxDataValidationGroup } from "./data-validation-group";
import { XlsxDvRuleManager } from "./dv-rule-manager";

function lookup(key: string): string {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, viLocale) as string;
}

const SELECTION = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
const FAR = { startRow: 20, endRow: 22, startColumn: 5, endColumn: 5 };

const RULES: XlsxLiveRule[] = [
  { id: "dv-a", ranges: [SELECTION], rule: { type: "list", formula1: "a,b", errorStyle: 2, error: "oops", showErrorMessage: true } },
  { id: "dv-b", ranges: [FAR], rule: { type: "whole", operator: "between", formula1: "1", formula2: "5", errorStyle: 1 } },
  { id: "dv-c", ranges: [SELECTION], rule: { type: "custom", formula1: "=A1>0" } },
];

function setup(options: { result?: boolean; x14?: boolean } = {}) {
  const execute = vi.fn((_id: string, _params?: unknown) => options.result ?? true);
  const readRuleSets = vi.fn((_sheet: string, _family: string) => RULES);
  const onClose = vi.fn();
  render(
    <XlsxDvRuleManager
      unitId="file-abc"
      subUnitId="sheet-1"
      commands={{ execute, readRuleSets }}
      selection={SELECTION}
      x14={options.x14}
      onClose={onClose}
    />,
  );
  return { execute, readRuleSets, onClose };
}

const rowOf = (id: string) => screen.getByTestId(`xlsx-dv-rule-${id}`);

describe("XlsxDvRuleManager", () => {
  it("lists rules touching the selection, then the whole sheet", () => {
    const { readRuleSets } = setup();
    expect(readRuleSets).toHaveBeenCalledWith("sheet-1", "dataValidations");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("xlsx-rule-scope-sheet"));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(within(rowOf("dv-b")).getByTestId("xlsx-dv-rule-areas")).toHaveTextContent("F21:F23");
  });

  it("describes type, operator, values, areas and error style", () => {
    setup();
    fireEvent.click(screen.getByTestId("xlsx-rule-scope-sheet"));
    expect(within(rowOf("dv-a")).getByText(lookup("office.xlsx.dataValidation.manager.rules.list").replace("{{items}}", "a,b"))).toBeInTheDocument();
    expect(within(rowOf("dv-a")).getByTestId("xlsx-dv-rule-style")).toHaveTextContent(lookup("office.xlsx.dataValidation.errorStyles.warning"));
    const between = lookup("office.xlsx.dataValidation.manager.rules.range")
      .replace("{{type}}", lookup("office.xlsx.dataValidation.types.whole"))
      .replace("{{operator}}", lookup("office.xlsx.dataValidation.operators.between"))
      .replace("{{min}}", "1")
      .replace("{{max}}", "5");
    expect(within(rowOf("dv-b")).getByText(between)).toBeInTheDocument();
    expect(within(rowOf("dv-b")).getByTestId("xlsx-dv-rule-style")).toHaveTextContent(lookup("office.xlsx.dataValidation.errorStyles.stop"));
    expect(within(rowOf("dv-c")).getByText(lookup("office.xlsx.dataValidation.manager.rules.other").replace("{{type}}", "custom"))).toBeInTheDocument();
  });

  it("edits through the prefilled dialog: setting, options, ranges in order", async () => {
    const { execute } = setup();
    fireEvent.click(within(rowOf("dv-a")).getByTestId("xlsx-dv-rule-edit"));
    const source = await screen.findByTestId("xlsx-dv-source");
    expect(source).toHaveValue("a,b");
    fireEvent.change(source, { target: { value: "a,b,c" } });
    fireEvent.click(screen.getByTestId("xlsx-dv-apply"));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(execute.mock.calls.map((call) => call[0])).toEqual([
      "sheets.command.update-data-validation-setting",
      "sheets.command.update-data-validation-options",
      "sheet.command.updateDataValidationRuleRange",
    ]);
    expect(execute.mock.calls[0]![1]).toEqual({
      unitId: "file-abc",
      subUnitId: "sheet-1",
      ruleId: "dv-a",
      setting: { type: "list", operator: undefined, formula1: "a,b,c", formula2: undefined, allowBlank: true },
    });
    expect(execute.mock.calls[1]![1]).toEqual({
      unitId: "file-abc",
      subUnitId: "sheet-1",
      ruleId: "dv-a",
      options: { errorStyle: 2, error: "oops", errorTitle: "", showErrorMessage: true },
    });
    expect(execute.mock.calls[2]![1]).toEqual({ unitId: "file-abc", subUnitId: "sheet-1", ruleId: "dv-a", ranges: [SELECTION] });
    await waitFor(() => expect(screen.queryByTestId("xlsx-dv-apply")).not.toBeInTheDocument());
  });

  it("disables Edit with a reason for rules the dialog cannot rebuild", () => {
    setup();
    const edit = within(rowOf("dv-c")).getByTestId("xlsx-dv-rule-edit");
    expect(edit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(edit);
    expect(screen.queryByTestId("xlsx-dv-apply")).not.toBeInTheDocument();
  });

  it("deletes a rule with exact params", () => {
    const { execute } = setup();
    fireEvent.click(within(rowOf("dv-a")).getByTestId("xlsx-dv-rule-delete"));
    expect(execute).toHaveBeenCalledWith("sheet.command.remove-data-validation-rule", { unitId: "file-abc", subUnitId: "sheet-1", ruleId: "dv-a" });
  });

  it("keeps the manager open with an alert when delete is refused", async () => {
    const { onClose } = setup({ result: false });
    fireEvent.click(within(rowOf("dv-a")).getByTestId("xlsx-dv-rule-delete"));
    expect(await screen.findByRole("alert")).toHaveTextContent(lookup("office.xlsx.dataValidation.errors.refused"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the x14 reason and disables every action on an x14 sheet", () => {
    const { execute } = setup({ x14: true });
    expect(screen.getByTestId("xlsx-dv-manager-x14")).toHaveTextContent(lookup("office.xlsx.dataValidation.errors.x14Sheet"));
    for (const id of ["xlsx-dv-rule-edit", "xlsx-dv-rule-delete"]) {
      for (const button of screen.getAllByTestId(id)) {
        expect(button).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(button);
      }
    }
    expect(execute).not.toHaveBeenCalled();
    expect(screen.queryByTestId("xlsx-dv-apply")).not.toBeInTheDocument();
  });
});

describe("Manage validation rules entry point", () => {
  const props = (overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps =>
    ({
      readOnly: false,
      selection: { sheet: "Data", address: "A1", endAddress: "C4" },
      canUndo: true,
      canRedo: true,
      canRecalculate: true,
      canFormat: true,
      recalculating: false,
      commands: { execute: vi.fn(() => true), readRuleSets: () => RULES },
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
    }) as XlsxToolbarGroupProps;

  it("opens the manager from the group", () => {
    render(<XlsxDataValidationGroup {...props()} />);
    const button = screen.getByTestId("xlsx-dv-manage");
    expect(button).toHaveAccessibleName(lookup("office.xlsx.dataValidation.manage"));
    fireEvent.click(button);
    expect(screen.getByTestId("xlsx-dv-manager")).toBeInTheDocument();
  });

  it("passes the x14 flag of the sheet to the manager", () => {
    const host = { file: { sheets: [{ id: "sheet-1", ruleSets: { conditionalFormats: "none", dataValidations: "x14" } }] } } as unknown as XlsxToolbarGroupProps["host"];
    render(<XlsxDataValidationGroup {...props({ host })} />);
    fireEvent.click(screen.getByTestId("xlsx-dv-manage"));
    expect(screen.getByTestId("xlsx-dv-manager-x14")).toBeInTheDocument();
  });

  it("is aria-disabled when the port cannot read rules", () => {
    render(<XlsxDataValidationGroup {...props({ commands: { execute: vi.fn(() => true) } })} />);
    const button = screen.getByTestId("xlsx-dv-manage");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(screen.queryByTestId("xlsx-dv-manager")).not.toBeInTheDocument();
  });
});
