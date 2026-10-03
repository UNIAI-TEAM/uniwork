import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import { XlsxAdvancedFilterDialog, type XlsxAdvancedFilterDialogProps } from "./advanced-filter-dialog";

const SHA = "b".repeat(64);

const cell = (value: RendererRangeCell["value"], row = 0, column = 0): RendererRangeCell => ({ row, column, value });

const result = (cells: RendererRangeCell[], extra: Partial<RendererRangeResult> = {}): RendererRangeResult =>
  ({ cells, indexingComplete: true, indexedThroughRow: null, ...extra }) as RendererRangeResult;

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

const selection: XlsxSelection = { sheet: "Data", address: "A1", endAddress: "B3" };

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

const header = async () => result([cell("Region", 0, 0), cell("Sales", 0, 1)]);

function renderDialog(overrides: Partial<XlsxAdvancedFilterDialogProps> = {}, readRange?: XlsxGridHostPort["readRange"]) {
  const execute = vi.fn((_id: string, _params?: unknown) => true);
  const commands: XlsxToolbarCommands = { execute };
  const onClose = vi.fn();
  const props: XlsxAdvancedFilterDialogProps = {
    documentKey: "doc",
    host: host(readRange ?? (async () => header())),
    commands,
    selection,
    onClose,
    ...overrides,
  };
  render(<XlsxAdvancedFilterDialog {...props} />);
  return { execute, onClose };
}

async function dialogReady() {
  return screen.findByTestId("xlsx-filter-value-0");
}

describe("XlsxAdvancedFilterDialog", () => {
  it("reads the selection's header row and applies criteria through the command port", async () => {
    const readRange = vi.fn(async () => header());
    const { execute, onClose } = renderDialog({}, readRange);
    await dialogReady();
    expect(readRange).toHaveBeenCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
    });
    fireEvent.change(screen.getByTestId("xlsx-filter-value-0"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByTestId("xlsx-filter-apply"));
    expect(execute).toHaveBeenNthCalledWith(1, "sheet.command.set-filter-range", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
    });
    expect(execute).toHaveBeenNthCalledWith(2, "sheet.command.set-filter-criteria", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      col: 0,
      criteria: { colId: 0, customFilters: { customFilters: [{ val: "alpha" }] } },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("joins two conditions on one column with AND", async () => {
    const { execute } = renderDialog();
    await dialogReady();
    fireEvent.change(screen.getByTestId("xlsx-filter-value-0"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByTestId("xlsx-filter-add-condition"));
    fireEvent.change(await screen.findByTestId("xlsx-filter-value-1"), { target: { value: "beta" } });
    fireEvent.click(screen.getByTestId("xlsx-filter-join-and"));
    fireEvent.click(screen.getByTestId("xlsx-filter-apply"));
    const [call] = execute.mock.calls.filter(([id]) => id === "sheet.command.set-filter-criteria");
    expect(call?.[1]).toMatchObject({
      col: 0,
      criteria: { colId: 0, customFilters: { and: 1, customFilters: [{ val: "alpha" }, { val: "beta" }] } },
    });
  });

  it("refuses an empty value before any command runs", async () => {
    const { execute, onClose } = renderDialog();
    await dialogReady();
    fireEvent.click(screen.getByTestId("xlsx-filter-apply"));
    expect(await screen.findByTestId("xlsx-filter-error")).toHaveTextContent(text("office.xlsx.filter.dialog.valueRequired"));
    expect(execute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports a refused command and keeps the dialog open", async () => {
    const { execute, onClose } = renderDialog({}, async () => header());
    execute.mockReturnValue(false);
    await dialogReady();
    fireEvent.change(screen.getByTestId("xlsx-filter-value-0"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByTestId("xlsx-filter-apply"));
    await waitFor(() =>
      expect(screen.getByTestId("xlsx-filter-error")).toHaveTextContent(text("office.xlsx.filter.dialog.applyFailed")),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays inert without a selection", async () => {
    renderDialog({ selection: null });
    expect(await screen.findByTestId("xlsx-filter-unavailable")).toHaveTextContent(text("office.xlsx.filter.dialog.noSelection"));
    expect(screen.getByTestId("xlsx-filter-apply")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("xlsx filter i18n parity", () => {
  it("keeps the filter subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.filter"));
    expect(subtree(en).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
