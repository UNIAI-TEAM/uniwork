import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { XLSX_TOOLBAR_GROUPS } from "./registry";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxSortGroup } from "./sort-group";

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

const host = {
  file: {
    sessionId: "s-1",
    sha256: "d".repeat(64),
    sheets: [{ id: "sheet-1", name: "Data", rowCount: 100, columnCount: 26 }],
  },
  readRange: async () => ({ cells: [], indexingComplete: true, indexedThroughRow: null }),
} as unknown as XlsxGridHostPort;

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
    host,
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

describe("XlsxSortGroup", () => {
  it("fires the pinned sort command with a single key on the selection's first column", () => {
    const execute = vi.fn(() => true);
    render(<XlsxSortGroup {...groupProps({ commands: { execute } })} />);
    expect(screen.getByTestId("xlsx-sort-asc")).toHaveAccessibleName(lookup(viLocale, "office.xlsx.sort.ascendingShort"));
    expect(screen.getByTestId("xlsx-sort-asc")).toHaveAttribute("title", lookup(viLocale, "office.xlsx.sort.ascending") as string);
    fireEvent.click(screen.getByTestId("xlsx-sort-asc"));
    expect(execute).toHaveBeenCalledWith("sheet.command.sort-range", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
      range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 },
      orderRules: [{ type: "asc", colIndex: 0 }],
      hasTitle: false,
    });
    fireEvent.click(screen.getByTestId("xlsx-sort-desc"));
    expect(execute).toHaveBeenLastCalledWith(
      "sheet.command.sort-range",
      expect.objectContaining({ orderRules: [{ type: "desc", colIndex: 0 }] }),
    );
  });

  it("shows visible short labels on the two one-click sorts", () => {
    render(<XlsxSortGroup {...groupProps()} />);
    expect(screen.getByTestId("xlsx-sort-asc")).toHaveTextContent(lookup(viLocale, "office.xlsx.sort.ascendingShort") as string);
    expect(screen.getByTestId("xlsx-sort-desc")).toHaveTextContent(lookup(viLocale, "office.xlsx.sort.descendingShort") as string);
    expect(screen.getByTestId("xlsx-sort-desc")).toHaveAttribute("title", lookup(viLocale, "office.xlsx.sort.descending") as string);
  });

  it("refuses an over-budget range with a message and never calls the command", () => {
    const execute = vi.fn(() => true);
    // 1001 x 11 = 11_011 cells > the 10_000 engine budget.
    render(<XlsxSortGroup {...groupProps({ selection: { sheet: "Data", address: "A1", endAddress: "K1001" }, commands: { execute } })} />);
    fireEvent.click(screen.getByTestId("xlsx-sort-asc"));
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByTestId("xlsx-sort-limit-error")).toHaveTextContent(
      (lookup(viLocale, "office.xlsx.sort.limitExceeded") as string).replace("{{limit}}", "10000"),
    );
  });

  it("opens the group-owned custom sort dialog", () => {
    render(<XlsxSortGroup {...groupProps()} />);
    const button = screen.getByTestId("xlsx-sort-custom");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    expect(screen.getByTestId("xlsx-custom-sort")).toBeInTheDocument();
  });

  it("stays in the tab order and inert without a grid, a selection or edit rights", () => {
    // The two one-click sorts need the commands port, a bound selection and
    // edit rights; the custom-sort dialog additionally needs the renderer host.
    // Each control is asserted against its own gate and stays focusable.
    for (const [overrides, disabledIds] of [
      [{ commands: undefined }, ["xlsx-sort-asc", "xlsx-sort-desc", "xlsx-sort-custom"]],
      [{ host: undefined }, ["xlsx-sort-custom"]],
      [{ selection: null }, ["xlsx-sort-asc", "xlsx-sort-desc", "xlsx-sort-custom"]],
      [{ sheetName: null }, ["xlsx-sort-asc", "xlsx-sort-desc", "xlsx-sort-custom"]],
      [{ readOnly: true }, ["xlsx-sort-asc", "xlsx-sort-desc", "xlsx-sort-custom"]],
    ] as [Partial<XlsxToolbarGroupProps>, string[]][]) {
      const execute = vi.fn(() => true);
      // `{ commands: undefined }` must genuinely omit the port; the other cases
      // keep a fresh spy so the per-case `execute` call count is isolated.
      const commands = "commands" in overrides ? overrides.commands : { execute };
      const view = render(<XlsxSortGroup {...groupProps({ ...overrides, commands })} />);
      for (const testId of ["xlsx-sort-asc", "xlsx-sort-desc", "xlsx-sort-custom"]) {
        const button = screen.getByTestId(testId);
        expect(button).not.toBeDisabled();
        if (disabledIds.includes(testId)) {
          expect(button).toHaveAttribute("aria-disabled", "true");
          fireEvent.click(button);
        } else {
          expect(button).not.toHaveAttribute("aria-disabled");
        }
      }
      expect(execute).not.toHaveBeenCalled();
      expect(screen.queryByTestId("xlsx-custom-sort")).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("xlsx sort registry entry", () => {
  it("registers the group on the Data tab with a label in both locales", () => {
    const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === "sort");
    if (!group) throw new Error("missing registry group sort");
    expect(group.tab).toBe("data");
    expect(group.labelKey).toBe("office.xlsx.sort.groups.data");
    for (const locale of [en, viLocale]) {
      expect(typeof lookup(locale, group.labelKey)).toBe("string");
    }
  });

  it("keeps the sort subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.sort"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
