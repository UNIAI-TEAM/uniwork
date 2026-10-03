import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import { XlsxFindPanel, type XlsxFindPanelProps } from "./find-panel";

const SHA = "b".repeat(64);

const cell = (value: RendererRangeCell["value"], row = 0, column = 0, formula?: string): RendererRangeCell => ({
  row,
  column,
  value,
  ...(formula === undefined ? {} : { formula }),
});

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

function withVars(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name]));
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

const selection = (address: string, endAddress?: string): XlsxSelection => ({
  sheet: "Data",
  address,
  ...(endAddress === undefined ? {} : { endAddress }),
});

function host(
  readRange: XlsxGridHostPort["readRange"],
  sheets: { id: string; name: string; rowCount: number; columnCount: number }[] = [
    { id: "sheet-1", name: "Data", rowCount: 100, columnCount: 26 },
  ],
): XlsxGridHostPort {
  return {
    file: { sessionId: "s-1", sha256: SHA, sheets },
    readRange,
  } as unknown as XlsxGridHostPort;
}

function renderPanel(overrides: Partial<XlsxFindPanelProps> = {}, readRange?: XlsxGridHostPort["readRange"]) {
  const execute = vi.fn((_id: string, _params?: unknown) => true);
  const commands: XlsxToolbarCommands = { execute };
  const onClose = vi.fn();
  const props: XlsxFindPanelProps = {
    documentKey: "doc",
    host: host(readRange ?? (async () => result([cell("alpha", 0, 0), cell("beta", 0, 1)]))),
    commands,
    selection: selection("A1", "B1"),
    sheetName: "Data",
    dirtyGeneration: 0,
    onClose,
    ...overrides,
  };
  render(<XlsxFindPanel {...props} />);
  return { execute, onClose };
}

async function panelReady() {
  return screen.findByTestId("xlsx-find-panel");
}

describe("XlsxFindPanel", () => {
  it("opens with the find, replace and option controls and an honest empty state", async () => {
    const readRange = vi.fn(async () => result([cell("alpha", 0, 0)]));
    renderPanel({}, readRange);
    await panelReady();
    expect(screen.getByTestId("xlsx-find-query")).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-find-replacement")).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-find-match-case")).toHaveAttribute("aria-pressed", "false");
    expect(readRange).toHaveBeenCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
    });
    await waitFor(() => expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(text("office.xlsx.find.status.typeQuery")));
    expect(screen.getByTestId("xlsx-find-previous")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("xlsx-find-replace")).toHaveAttribute("aria-disabled", "true");
  });

  it("counts matches, moves the grid to one and shows the position", async () => {
    const { execute } = renderPanel({}, async () => result([cell("alpha", 0, 0), cell("alpha", 0, 1)]));
    await panelReady();
    fireEvent.change(screen.getByTestId("xlsx-find-query"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(withVars(text("office.xlsx.find.status.matches"), { count: 2 })));
    fireEvent.click(screen.getByTestId("xlsx-find-next"));
    expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(withVars(text("office.xlsx.find.status.position"), { index: 1, count: 2 }));
    expect(execute).toHaveBeenCalledWith("sheet.command.select-range", {
      unitId: `file-${SHA}`,
      subUnit: "sheet-1",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    });
  });

  it("re-matches when match case changes", async () => {
    renderPanel({}, async () => result([cell("Alpha", 0, 0), cell("alpha", 0, 1)]));
    await panelReady();
    fireEvent.change(screen.getByTestId("xlsx-find-query"), { target: { value: "ALPHA" } });
    await waitFor(() => expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(withVars(text("office.xlsx.find.status.matches"), { count: 2 })));
    fireEvent.click(screen.getByTestId("xlsx-find-match-case"));
    expect(screen.getByTestId("xlsx-find-match-case")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(text("office.xlsx.find.status.noMatches"));
  });

  it("re-reads the used sheet when the scope switches", async () => {
    const readRange = vi.fn(async () => result([cell("alpha", 0, 0)]));
    renderPanel({}, readRange);
    await panelReady();
    fireEvent.click(screen.getByTestId("xlsx-find-scope-sheet"));
    await waitFor(() =>
      expect(readRange).toHaveBeenLastCalledWith({
        sessionId: "s-1",
        sheetId: "sheet-1",
        range: { startRow: 0, endRow: 99, startColumn: 0, endColumn: 25 },
      }),
    );
    expect(screen.getByTestId("xlsx-find-scope-sheet")).toHaveAttribute("aria-pressed", "true");
  });

  it("replaces the current match through the range-values command", async () => {
    const { execute } = renderPanel({}, async () => result([cell("alpha", 0, 0)]));
    await panelReady();
    fireEvent.change(screen.getByTestId("xlsx-find-query"), { target: { value: "alpha" } });
    fireEvent.change(screen.getByTestId("xlsx-find-replacement"), { target: { value: "beta" } });
    fireEvent.click(screen.getByTestId("xlsx-find-next"));
    await waitFor(() => expect(screen.getByTestId("xlsx-find-replace")).not.toHaveAttribute("aria-disabled"));
    execute.mockClear();
    fireEvent.click(screen.getByTestId("xlsx-find-replace"));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { 0: { 0: { v: "beta" } } },
    });
    expect(screen.getByTestId("xlsx-find-replaced")).toHaveTextContent(text("office.xlsx.find.status.replaced"));
  });

  it("refuses a replace-all above the engine op bound and never sends it", async () => {
    const rows = 10_001;
    const readRange = async () => result(Array.from({ length: rows }, (_, row) => cell("alpha", row, 0)));
    const { execute } = renderPanel({ selection: selection("A1", `A${rows}`), host: host(readRange, [{ id: "sheet-1", name: "Data", rowCount: rows, columnCount: 1 }]) });
    await panelReady();
    fireEvent.change(screen.getByTestId("xlsx-find-query"), { target: { value: "alpha" } });
    fireEvent.change(screen.getByTestId("xlsx-find-replacement"), { target: { value: "beta" } });
    await waitFor(() => expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(withVars(text("office.xlsx.find.status.matches"), { count: rows })));
    execute.mockClear();
    fireEvent.click(screen.getByTestId("xlsx-find-replace-all"));
    expect(screen.getByTestId("xlsx-find-limit")).toHaveTextContent(
      withVars(text("office.xlsx.find.status.limit"), { limit: 10_000, count: rows }),
    );
    expect(execute.mock.calls.filter(([id]) => id === "sheet.command.set-range-values")).toHaveLength(0);
  });

  it("keeps formula matches visible but out of the replacement batch", async () => {
    renderPanel({}, async () => result([cell("alpha", 0, 0), cell("alpha", 0, 1, "=A1")]));
    await panelReady();
    fireEvent.change(screen.getByTestId("xlsx-find-query"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByTestId("xlsx-find-formula-hint")).toHaveTextContent(
      withVars(text("office.xlsx.find.status.formulaHint"), { count: 1 }),
    ));
    fireEvent.click(screen.getByTestId("xlsx-find-replace-all"));
    expect(screen.getByTestId("xlsx-find-replaced-all")).toHaveTextContent(
      withVars(text("office.xlsx.find.status.replacedAll"), { count: 1 }),
    );
  });

  it("states the read bound when the host could only serve part of the sheet", async () => {
    renderPanel(
      { selection: selection("A1", "A3") },
      async () => result([cell("alpha", 0, 0)], { indexingComplete: false, indexedThroughRow: 0 }),
    );
    await panelReady();
    expect(screen.getByTestId("xlsx-find-partial")).toHaveTextContent(
      withVars(text("office.xlsx.find.status.partial"), { scanned: 1, total: 3 }),
    );
    expect(screen.queryByTestId("xlsx-find-limit")).not.toBeInTheDocument();
  });

  it("reports a failed read instead of a fake zero", async () => {
    renderPanel({}, async () => {
      throw new Error("sidecar down");
    });
    await panelReady();
    expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(text("office.xlsx.find.status.error"));
    expect(screen.getByTestId("xlsx-find-replace-all")).toHaveAttribute("aria-disabled", "true");
  });

  it("disables replacement on a read-only document while find still reads", async () => {
    renderPanel({ readOnly: true }, async () => result([cell("alpha", 0, 0)]));
    await panelReady();
    fireEvent.change(screen.getByTestId("xlsx-find-query"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(withVars(text("office.xlsx.find.status.matches"), { count: 1 })));
    expect(screen.getByTestId("xlsx-find-replace")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("xlsx-find-replace-all")).toHaveAttribute("aria-disabled", "true");
  });

  it("closes through the dialog close button", async () => {
    const { onClose } = renderPanel();
    await panelReady();
    fireEvent.click(screen.getByRole("button", { name: text("office.xlsx.find.close") }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the pending read honest without hiding the previous count", async () => {
    let release!: (value: RendererRangeResult) => void;
    const gate = new Promise<RendererRangeResult>((resolve) => { release = resolve; });
    const readRange = vi.fn().mockResolvedValueOnce(result([cell("alpha", 0, 0)])).mockReturnValueOnce(gate);
    const { execute } = renderPanel({}, readRange);
    await panelReady();
    fireEvent.change(screen.getByTestId("xlsx-find-query"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(withVars(text("office.xlsx.find.status.matches"), { count: 1 })));
    fireEvent.click(screen.getByTestId("xlsx-find-scope-sheet"));
    expect(screen.getByTestId("xlsx-find-pending")).toHaveTextContent(text("office.xlsx.find.status.reading"));
    await act(async () => {
      release(result([cell("alpha", 0, 0), cell("alpha", 5, 0)]));
      await gate;
    });
    expect(screen.getByTestId("xlsx-find-status")).toHaveTextContent(withVars(text("office.xlsx.find.status.matches"), { count: 2 }));
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("xlsx find i18n", () => {
  it("carries the same find keys in vi and en", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.find"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
