import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxLiveRule, XlsxToolbarGroupProps } from "../toolbar/types";
import { XlsxConditionalFormatGroup } from "./conditional-format-group";
import { XlsxCfRuleManager } from "./cf-rule-manager";

function lookup(dictionary: unknown, key: string): string {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary) as string;
}

const SELECTION = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
const FAR = { startRow: 20, endRow: 22, startColumn: 5, endColumn: 5 };
const RED = { bg: { rgb: "#FFC7CE" }, cl: { rgb: "#9C0006" } };

const RULES: XlsxLiveRule[] = [
  { id: "cf-a", ranges: [SELECTION], stopIfTrue: true, rule: { type: "highlightCell", subType: "number", operator: "greaterThan", value: 7, style: RED } },
  { id: "cf-b", ranges: [FAR], rule: { type: "highlightCell", subType: "text", operator: "containsText", value: "abc", style: RED } },
  { id: "cf-c", ranges: [SELECTION], rule: { type: "dataBar", config: {} } },
  { id: "cf-d", ranges: [SELECTION], rule: { type: "highlightCell", subType: "uniqueValues", style: RED } },
];

function setup(result: boolean | Promise<boolean> = true, rules: readonly XlsxLiveRule[] = RULES) {
  const execute = vi.fn((_id: string, _params?: unknown) => result);
  const readRuleSets = vi.fn((_sheet: string, _family: string) => rules);
  const onClose = vi.fn();
  render(
    <XlsxCfRuleManager
      unitId="file-abc"
      subUnitId="sheet-1"
      commands={{ execute, readRuleSets }}
      selection={SELECTION}
      onClose={onClose}
    />,
  );
  return { execute, readRuleSets, onClose };
}

const rowOf = (id: string) => screen.getByTestId(`xlsx-cf-rule-${id}`);
const rules = (key: string) => lookup(viLocale, `office.xlsx.conditionalFormat.manager.${key}`);

describe("XlsxCfRuleManager", () => {
  it("lists the rules touching the selection and widens to the whole sheet", () => {
    const { readRuleSets } = setup();
    expect(readRuleSets).toHaveBeenCalledWith("sheet-1", "conditionalFormats");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByTestId("xlsx-cf-rule-cf-b")).not.toBeInTheDocument();
    expect(screen.getByTestId("xlsx-rule-scope-selection")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("xlsx-rule-scope-sheet"));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(within(rowOf("cf-b")).getByTestId("xlsx-cf-rule-areas")).toHaveTextContent("F21:F23");
  });

  it("describes each rule and previews highlight formats only", () => {
    setup();
    expect(within(rowOf("cf-a")).getByText(rules("rules.number.greaterThan").replace("{{value}}", "7"))).toBeInTheDocument();
    expect(within(rowOf("cf-a")).getByTestId("xlsx-cf-rule-areas")).toHaveTextContent("A1:C4");
    expect(within(rowOf("cf-a")).getByTestId("xlsx-cf-rule-chip")).toHaveStyle({ backgroundColor: "#FFC7CE" });
    expect(within(rowOf("cf-c")).getByText(rules("rules.dataBar"))).toBeInTheDocument();
    expect(within(rowOf("cf-c")).queryByTestId("xlsx-cf-rule-chip")).not.toBeInTheDocument();
    expect(within(rowOf("cf-d")).getByText(rules("rules.uniqueValues"))).toBeInTheDocument();
  });

  it("shows the empty state", () => {
    setup(true, []);
    expect(screen.getByTestId("xlsx-cf-manager-empty")).toHaveTextContent(rules("empty.selection"));
    fireEvent.click(screen.getByTestId("xlsx-rule-scope-sheet"));
    expect(screen.getByTestId("xlsx-cf-manager-empty")).toHaveTextContent(rules("empty.sheet"));
  });

  it("names every action after its rule", () => {
    setup();
    const label = rules("rules.number.greaterThan").replace("{{value}}", "7");
    const row = within(rowOf("cf-a"));
    expect(row.getByRole("button", { name: rules("edit").replace("{{rule}}", label) })).toBeInTheDocument();
    expect(row.getByRole("button", { name: rules("moveUp").replace("{{rule}}", label) })).toBeInTheDocument();
    expect(row.getByRole("button", { name: rules("moveDown").replace("{{rule}}", label) })).toBeInTheDocument();
    expect(row.getByRole("button", { name: rules("delete").replace("{{rule}}", label) })).toBeInTheDocument();
  });

  it("opens the preset dialog prefilled and fires set-conditional-rule with the same id, areas and flag", async () => {
    const { execute } = setup();
    fireEvent.click(within(rowOf("cf-a")).getByTestId("xlsx-cf-rule-edit"));
    const first = await screen.findByTestId("xlsx-cf-first");
    expect(first).toHaveValue("7");
    fireEvent.change(first, { target: { value: "9" } });
    fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-conditional-rule", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
      cfId: "cf-a",
      rule: {
        cfId: "cf-a",
        ranges: [SELECTION],
        stopIfTrue: true,
        rule: { type: "highlightCell", subType: "number", operator: "greaterThan", value: 9, style: RED },
      },
    });
    await waitFor(() => expect(screen.queryByTestId("xlsx-cf-ok")).not.toBeInTheDocument());
    expect(screen.getByTestId("xlsx-cf-manager")).toBeInTheDocument();
  });

  it("disables Edit with a reason for rules the preset dialog cannot rebuild", () => {
    setup();
    const edit = within(rowOf("cf-c")).getByTestId("xlsx-cf-rule-edit");
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(edit).toHaveAttribute("title", rules("editUnsupported"));
    fireEvent.click(edit);
    expect(screen.queryByTestId("xlsx-cf-ok")).not.toBeInTheDocument();
  });

  it("moves a rule before the previous and after the next visible rule, and disables the ends", async () => {
    const { execute } = setup();
    fireEvent.click(within(rowOf("cf-c")).getByTestId("xlsx-cf-rule-up"));
    expect(execute).toHaveBeenLastCalledWith("sheet.command.move-conditional-rule", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
      start: { id: "cf-c", type: "self" },
      end: { id: "cf-a", type: "before" },
    });
    {
      await waitFor(() => expect(within(rowOf("cf-c")).getByTestId("xlsx-cf-rule-down")).not.toHaveAttribute("aria-disabled"));
      fireEvent.click(within(rowOf("cf-c")).getByTestId("xlsx-cf-rule-down"));
      expect(execute).toHaveBeenLastCalledWith("sheet.command.move-conditional-rule", {
        unitId: "file-abc",
        subUnitId: "sheet-1",
        start: { id: "cf-c", type: "self" },
        end: { id: "cf-d", type: "after" },
      });
      expect(within(rowOf("cf-a")).getByTestId("xlsx-cf-rule-up")).toHaveAttribute("aria-disabled", "true");
      expect(within(rowOf("cf-d")).getByTestId("xlsx-cf-rule-down")).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("does nothing from a disabled end button", () => {
    const { execute } = setup();
    fireEvent.click(within(rowOf("cf-a")).getByTestId("xlsx-cf-rule-up"));
    fireEvent.click(within(rowOf("cf-d")).getByTestId("xlsx-cf-rule-down"));
    expect(execute).not.toHaveBeenCalled();
  });

  it("deletes a rule with exact params and re-reads the list", async () => {
    const { execute, readRuleSets } = setup();
    const reads = readRuleSets.mock.calls.length;
    fireEvent.click(within(rowOf("cf-d")).getByTestId("xlsx-cf-rule-delete"));
    expect(execute).toHaveBeenCalledWith("sheet.command.delete-conditional-rule", { unitId: "file-abc", subUnitId: "sheet-1", cfId: "cf-d" });
    await waitFor(() => expect(readRuleSets.mock.calls.length).toBeGreaterThan(reads));
  });

  it("keeps the dialog open with an alert when a command is refused", async () => {
    const { onClose } = setup(false);
    fireEvent.click(within(rowOf("cf-d")).getByTestId("xlsx-cf-rule-delete"));
    expect(await screen.findByRole("alert")).toHaveTextContent(lookup(viLocale, "office.xlsx.conditionalFormat.errors.refused"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("xlsx-cf-manager")).toBeInTheDocument();
  });
});

describe("Manage Rules entry point", () => {
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

  it("opens the manager from the last menu item", async () => {
    render(<XlsxConditionalFormatGroup {...props()} />);
    fireEvent.click(screen.getByTestId("xlsx-cf-menu"));
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.getAttribute("data-testid"));
    expect(items[items.length - 1]).toBe("xlsx-cf-manage");
    fireEvent.click(screen.getByTestId("xlsx-cf-manage"));
    expect(await screen.findByTestId("xlsx-cf-manager")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("stays closed when the group is read-only", () => {
    render(<XlsxConditionalFormatGroup {...props({ readOnly: true })} />);
    fireEvent.click(screen.getByTestId("xlsx-cf-menu"));
    expect(screen.queryByTestId("xlsx-cf-manage")).not.toBeInTheDocument();
  });
});

describe("XlsxCfRuleManager linked x14 rules (review dvcf B2)", () => {
  it("offers no Edit for a linked rule, says why, and keeps reorder and delete", () => {
    const linked: XlsxLiveRule = { ...RULES[0]!, id: "cf-linked", linked: true };
    const { execute } = setup(true, [linked, RULES[3]!]);
    const edit = within(rowOf("cf-linked")).getByTestId("xlsx-cf-rule-edit");
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(edit).toHaveAttribute("title", rules("editLinked"));
    fireEvent.click(edit);
    expect(screen.queryByTestId("xlsx-cf-dialog")).not.toBeInTheDocument();
    expect(within(rowOf("cf-linked")).getByTestId("xlsx-cf-rule-delete")).not.toHaveAttribute("aria-disabled");
    // The same preset without the flag stays editable.
    expect(within(rowOf("cf-d")).getByTestId("xlsx-cf-rule-edit")).not.toHaveAttribute("aria-disabled");
    expect(execute).not.toHaveBeenCalled();
  });
});
