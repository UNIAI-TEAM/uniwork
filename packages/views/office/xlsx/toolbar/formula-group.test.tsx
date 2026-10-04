import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { XLSX_TOOLBAR_GROUPS } from "./registry";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxFormulaGroup } from "./formula-group";

const SHA = "d".repeat(64);

const cell = (value: RendererRangeCell["value"], row = 0, column = 0): RendererRangeCell => ({ row, column, value });

const result = (cells: RendererRangeCell[]): RendererRangeResult =>
  ({ cells, indexingComplete: true, indexedThroughRow: null }) as RendererRangeResult;

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

function host(readRange: XlsxGridHostPort["readRange"]): XlsxGridHostPort {
  return {
    file: {
      sessionId: "s-1",
      sha256: SHA,
      sheets: [{ id: "sheet-1", name: "Data", rowCount: 100, columnCount: 26 }],
    },
    readRange,
  } as unknown as XlsxGridHostPort;
}

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A4" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    formatState: null,
    host: host(async () => result([cell(1, 0, 0), cell(2, 1, 0), cell(3, 2, 0)])),
    unitId: `file-${SHA}`,
    sheetName: "Data",
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    onOpenFunctionLibrary: vi.fn(),
    ...overrides,
  };
}

describe("XlsxFormulaGroup", () => {
  it("opens the editor-owned function library dialog", () => {
    const onOpenFunctionLibrary = vi.fn();
    render(<XlsxFormulaGroup {...groupProps({ onOpenFunctionLibrary })} />);
    const button = screen.getByTestId("xlsx-function-library-open");
    expect(button).toHaveAccessibleName(text("office.xlsx.formulas.library.open"));
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    expect(onOpenFunctionLibrary).toHaveBeenCalledOnce();
  });

  it("AutoSum reads the guess window and inserts =SUM over the block above", async () => {
    const readRange = vi.fn(async (input: { range: { startRow: number; endRow: number } }) =>
      result([cell(1, 0, 0), cell(2, 1, 0), cell(3, 2, 0)]),
    );
    const execute = vi.fn(() => true);
    render(<XlsxFormulaGroup {...groupProps({ host: host(readRange), commands: { execute } })} />);
    fireEvent.click(screen.getByTestId("xlsx-autosum"));
    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(readRange).toHaveBeenCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 0 },
    });
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { "3": { "0": { f: "=SUM(Data!A1:A3)" } } },
    });
  });

  it("AutoSum sums a multi-cell selection below it without reading", async () => {
    const readRange = vi.fn(async () => result([]));
    const execute = vi.fn(() => true);
    render(
      <XlsxFormulaGroup
        {...groupProps({
          host: host(readRange),
          commands: { execute },
          selection: { sheet: "Data", address: "A1", endAddress: "B2" },
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("xlsx-autosum"));
    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { "2": { "0": { f: "=SUM(Data!A1:B2)" } } },
    });
  });

  it("AutoSum writes the live sheet name after a session rename, not the file-time one", async () => {
    // The host file still carries the name at load ("Data"); the session
    // renamed the sheet to "Renamed" and only the live name + id resolver know.
    // The formula text must use the live name or the saved reference breaks.
    const readRange = vi.fn(async () => result([cell(1, 0, 0), cell(2, 1, 0), cell(3, 2, 0)]));
    const execute = vi.fn(() => true);
    const resolveSheetId = vi.fn((liveName: string) => (liveName === "Renamed" ? "sheet-1" : undefined));
    render(
      <XlsxFormulaGroup
        {...groupProps({
          host: host(readRange),
          commands: { execute },
          selection: { sheet: "Renamed", address: "A4" },
          sheetName: "Renamed",
          resolveSheetId,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("xlsx-autosum"));
    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { "3": { "0": { f: "=SUM(Renamed!A1:A3)" } } },
    });
  });

  it("AutoSum writes nothing and says so when the guess finds no numbers", async () => {
    const execute = vi.fn(() => true);
    render(<XlsxFormulaGroup {...groupProps({ host: host(async () => result([cell("x", 0, 0)])), commands: { execute } })} />);
    fireEvent.click(screen.getByTestId("xlsx-autosum"));
    expect(await screen.findByTestId("xlsx-autosum-empty")).toHaveTextContent(text("office.xlsx.formulas.autosum.empty"));
    expect(execute).not.toHaveBeenCalled();
  });

  it("AutoSum reports a refused command", async () => {
    render(<XlsxFormulaGroup {...groupProps({ commands: { execute: vi.fn(() => false) } })} />);
    fireEvent.click(screen.getByTestId("xlsx-autosum"));
    expect(await screen.findByTestId("xlsx-autosum-failed")).toHaveTextContent(text("office.xlsx.formulas.autosum.failed"));
  });

  it("AutoSum reports a rejected dispatch", async () => {
    render(<XlsxFormulaGroup {...groupProps({ commands: { execute: vi.fn(() => Promise.reject(new Error("handler exploded"))) } })} />);
    fireEvent.click(screen.getByTestId("xlsx-autosum"));
    expect(await screen.findByTestId("xlsx-autosum-failed")).toHaveTextContent(text("office.xlsx.formulas.autosum.failed"));
  });

  it("keeps both controls in the tab order and inert without a target or edit rights", () => {
    for (const overrides of [{ readOnly: true }, { selection: null }] as Partial<XlsxToolbarGroupProps>[]) {
      const execute = vi.fn(() => true);
      const onOpenFunctionLibrary = vi.fn();
      const view = render(<XlsxFormulaGroup {...groupProps({ ...overrides, commands: { execute }, onOpenFunctionLibrary })} />);
      for (const testId of ["xlsx-function-library-open", "xlsx-autosum"]) {
        const button = screen.getByTestId(testId);
        expect(button).toHaveAttribute("aria-disabled", "true");
        expect(button).not.toBeDisabled();
        fireEvent.click(button);
      }
      expect(onOpenFunctionLibrary).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("disables AutoSum alone when the grid is absent, and the library alone without its port or handler", () => {
    const noHost = render(<XlsxFormulaGroup {...groupProps({ host: undefined })} />);
    expect(screen.getByTestId("xlsx-autosum")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("xlsx-function-library-open")).not.toHaveAttribute("aria-disabled");
    noHost.unmount();

    for (const overrides of [{ commands: undefined }, { onOpenFunctionLibrary: undefined }] as Partial<XlsxToolbarGroupProps>[]) {
      const onOpenFunctionLibrary = vi.fn();
      const view = render(<XlsxFormulaGroup {...groupProps({ ...overrides, onOpenFunctionLibrary })} />);
      const button = screen.getByTestId("xlsx-function-library-open");
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
      expect(onOpenFunctionLibrary).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});

describe("xlsx formula registry entry", () => {
  it("registers the group on the Formulas tab with a label in both locales", () => {
    const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === "formula");
    if (!group) throw new Error("missing registry group formula");
    expect(group.tab).toBe("formulas");
    expect(group.labelKey).toBe("office.xlsx.toolbar.groups.formula.label");
    for (const locale of [en, viLocale]) {
      expect(typeof lookup(locale, group.labelKey)).toBe("string");
    }
  });

  it("keeps the formulas subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.formulas"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
