import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import { XlsxCustomSortDialog, type XlsxCustomSortDialogProps } from "./custom-sort-dialog";

const SHA = "c".repeat(64);

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

const selection: XlsxSelection = { sheet: "Data", address: "A1", endAddress: "C4" };

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

const header = async () => result([cell("Region", 0, 0), cell("Sales", 0, 1), cell("Owner", 0, 2)]);

function renderDialog(overrides: Partial<XlsxCustomSortDialogProps> = {}, readRange?: XlsxGridHostPort["readRange"]) {
  const execute = vi.fn((_id: string, _params?: unknown) => true);
  const commands: XlsxToolbarCommands = { execute };
  const onClose = vi.fn();
  const props: XlsxCustomSortDialogProps = {
    documentKey: "doc",
    host: host(readRange ?? (async () => header())),
    commands,
    selection,
    onClose,
    ...overrides,
  };
  render(<XlsxCustomSortDialog {...props} />);
  return { execute, onClose };
}

async function dialogReady() {
  return screen.findByTestId("xlsx-sort-apply");
}

describe("XlsxCustomSortDialog", () => {
  it("reads the selection's header row and applies a single-key sort through the command port", async () => {
    const readRange = vi.fn(async () => header());
    const { execute, onClose } = renderDialog({}, readRange);
    await dialogReady();
    expect(readRange).toHaveBeenCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 },
    });
    fireEvent.click(screen.getByTestId("xlsx-sort-apply"));
    expect(execute).toHaveBeenCalledWith("sheet.command.sort-range", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 },
      orderRules: [{ type: "asc", colIndex: 0 }],
      hasTitle: true,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("passes the has-header-row choice through to the command", async () => {
    const { execute } = renderDialog();
    await dialogReady();
    fireEvent.click(screen.getByTestId("xlsx-sort-header-row"));
    fireEvent.click(screen.getByTestId("xlsx-sort-apply"));
    expect(execute).toHaveBeenCalledWith(
      "sheet.command.sort-range",
      expect.objectContaining({ hasTitle: false }),
    );
  });

  it("refuses an over-budget range with the limit message and no command", async () => {
    const { execute, onClose } = renderDialog({
      selection: { sheet: "Data", address: "A1", endAddress: "K1001" },
    });
    await dialogReady();
    fireEvent.click(screen.getByTestId("xlsx-sort-apply"));
    expect(execute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("xlsx-sort-error")).toHaveTextContent(
      text("office.xlsx.sort.limitExceeded").replace("{{limit}}", "10000"),
    );
  });

  it("reports a refused command and keeps the dialog open", async () => {
    const { execute, onClose } = renderDialog();
    execute.mockResolvedValue(false);
    await dialogReady();
    fireEvent.click(screen.getByTestId("xlsx-sort-apply"));
    await waitFor(() =>
      expect(screen.getByTestId("xlsx-sort-error")).toHaveTextContent(text("office.xlsx.sort.applyFailed")),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports a rejected dispatch and keeps the dialog open", async () => {
    const { execute, onClose } = renderDialog();
    execute.mockRejectedValue(new Error("handler exploded"));
    await dialogReady();
    fireEvent.click(screen.getByTestId("xlsx-sort-apply"));
    await waitFor(() =>
      expect(screen.getByTestId("xlsx-sort-error")).toHaveTextContent(text("office.xlsx.sort.applyFailed")),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays inert without a selection", async () => {
    renderDialog({ selection: null });
    expect(await screen.findByTestId("xlsx-sort-unavailable")).toHaveTextContent(text("office.xlsx.sort.dialog.noSelection"));
    expect(screen.getByTestId("xlsx-sort-apply")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("xlsx sort i18n parity", () => {
  it("keeps the sort subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.sort"));
    expect(subtree(en).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
