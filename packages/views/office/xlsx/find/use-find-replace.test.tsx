import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import { useXlsxFindReplace, type XlsxFindReplaceOptions } from "./use-find-replace";

const SHA = "a".repeat(64);

const cell = (value: RendererRangeCell["value"], row = 0, column = 0, formula?: string): RendererRangeCell => ({
  row,
  column,
  value,
  ...(formula === undefined ? {} : { formula }),
});

const result = (cells: RendererRangeCell[], extra: Partial<RendererRangeResult> = {}): RendererRangeResult =>
  ({ cells, indexingComplete: true, indexedThroughRow: null, ...extra }) as RendererRangeResult;

function host(
  readRange: XlsxGridHostPort["readRange"],
  sheets: { id: string; name: string; rowCount: number; columnCount: number }[] = [
    { id: "sheet-1", name: "Data", rowCount: 100, columnCount: 26 },
  ],
): XlsxGridHostPort {
  return { file: { sessionId: "s-1", sha256: SHA, sheets }, readRange } as unknown as XlsxGridHostPort;
}

const selection = (address: string, endAddress?: string): XlsxSelection => ({
  sheet: "Data",
  address,
  ...(endAddress === undefined ? {} : { endAddress }),
});

function setup(overrides: Partial<XlsxFindReplaceOptions> = {}, readRange?: XlsxGridHostPort["readRange"]) {
  const execute = vi.fn((_id: string, _params?: unknown) => true);
  const commands: XlsxToolbarCommands = { execute };
  const props: XlsxFindReplaceOptions = {
    documentKey: "doc",
    host: host(readRange ?? (async (input) => result([cell("alpha", input.range.startRow, 0)])), undefined),
    commands,
    selection: selection("A1", "B1"),
    sheetName: "Data",
    dirtyGeneration: 0,
    ...overrides,
  };
  const view = renderHook((next: XlsxFindReplaceOptions) => useXlsxFindReplace(next), { initialProps: props });
  return { ...view, execute, commands };
}

async function ready(resultRef: { current: ReturnType<typeof useXlsxFindReplace> }) {
  await waitFor(() => expect(resultRef.current.scan.kind).toBe("ready"));
}

describe("useXlsxFindReplace scan", () => {
  it("reads the selection window through the host and counts query matches", async () => {
    const readRange = vi.fn(async () => result([cell("alpha", 0, 0), cell("beta", 0, 1), cell(null, 0, 2)]));
    const { result: hook } = setup({}, readRange);
    await ready(hook);
    expect(readRange).toHaveBeenCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
    });
    expect(hook.current.queryActive).toBe(false);
    expect(hook.current.matchCount).toBe(0);
    act(() => hook.current.changeQuery("alp"));
    expect(hook.current.matchCount).toBe(1);
    expect(hook.current.replaceableCount).toBe(1);
    act(() => hook.current.changeQuery("   "));
    expect(hook.current.matchCount).toBe(0);
    act(() => hook.current.changeQuery("nothing"));
    expect(hook.current.matchCount).toBe(0);
  });

  it("matches case-insensitively by default and case-sensitively on request", async () => {
    const readRange = async () => result([cell("Alpha", 0, 0), cell("alpha", 0, 1)]);
    const { result: hook } = setup({}, readRange);
    await ready(hook);
    act(() => hook.current.changeQuery("ALPHA"));
    expect(hook.current.matchCount).toBe(2);
    act(() => hook.current.changeMatchCase(true));
    expect(hook.current.matchCount).toBe(0);
  });

  it("scans the used sheet on the whole-sheet scope and reports the bounded window", async () => {
    const readRange = vi.fn(async () => result([cell("x", 0, 0)]));
    const { result: hook } = setup({}, readRange);
    await ready(hook);
    act(() => hook.current.changeScope("sheet"));
    await waitFor(() =>
      expect(readRange).toHaveBeenLastCalledWith({
        sessionId: "s-1",
        sheetId: "sheet-1",
        range: { startRow: 0, endRow: 99, startColumn: 0, endColumn: 25 },
      }),
    );
    expect(hook.current.scan.kind === "ready" && hook.current.scan.partial).toBe(false);
  });

  it("caps a large sheet to one block and says how much it read", async () => {
    const readRange = vi.fn(async () => result([cell("x", 0, 0)]));
    const { result: hook } = setup(
      {
        host: host(readRange, [{ id: "sheet-1", name: "Data", rowCount: 100_000, columnCount: 2 }]),
      },
      readRange,
    );
    await ready(hook);
    act(() => hook.current.changeScope("sheet"));
    await waitFor(() => expect(hook.current.scan.kind).toBe("ready"));
    expect(readRange).toHaveBeenLastCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 24_999, startColumn: 0, endColumn: 1 },
    });
    expect(hook.current.scan.kind === "ready" && hook.current.scan.partial).toBe(true);
    expect(hook.current.scan.kind === "ready" && hook.current.scan.scannedRows).toBe(25_000);
    expect(hook.current.scan.kind === "ready" && hook.current.scan.totalRows).toBe(100_000);
  });

  it("drops rows a partial host has not indexed", async () => {
    const readRange = async () =>
      result([cell("alpha", 0, 0), cell("alpha", 1, 0)], { indexingComplete: false, indexedThroughRow: 0 });
    const { result: hook } = setup({ selection: selection("A1", "A2") }, readRange);
    await ready(hook);
    act(() => hook.current.changeQuery("alpha"));
    expect(hook.current.matchCount).toBe(1);
    expect(hook.current.scan.kind === "ready" && hook.current.scan.partial).toBe(true);
    expect(hook.current.scan.kind === "ready" && hook.current.scan.scannedRows).toBe(1);
  });

  it("re-reads the same window when the dirty generation changes and drops stale replies", async () => {
    let release!: (value: RendererRangeResult) => void;
    const gate = new Promise<RendererRangeResult>((resolve) => { release = resolve; });
    const readRange = vi
      .fn()
      .mockResolvedValueOnce(result([cell("one", 0, 0)]))
      .mockReturnValueOnce(gate);
    const stableHost = host(readRange);
    const { result: hook, rerender } = setup({ host: stableHost });
    await ready(hook);
    rerender({
      documentKey: "doc",
      host: stableHost,
      commands: { execute: vi.fn(() => true) },
      selection: selection("A1", "B1"),
      sheetName: "Data",
      dirtyGeneration: 1,
    });
    expect(readRange).toHaveBeenCalledTimes(2);
    await act(async () => {
      release(result([cell("two", 0, 0)]));
      await gate;
    });
    act(() => hook.current.changeQuery("two"));
    expect(hook.current.matchCount).toBe(1);
  });

  it("keeps the selection window frozen when the panel's own reveal moves the selection prop", async () => {
    const readRange = vi.fn(async () => result([cell("alpha", 0, 0), cell("alpha", 1, 1), cell("alpha", 2, 0)]));
    const stableHost = host(readRange);
    const { result: hook, rerender, execute, commands } = setup({ host: stableHost, selection: selection("A1", "B3") });
    await ready(hook);
    act(() => hook.current.changeQuery("alpha"));
    expect(hook.current.matchCount).toBe(3);
    act(() => hook.current.findNext());
    expect(hook.current.currentIndex).toBe(0);
    const reads = readRange.mock.calls.length;
    // The grid reports the panel's select-range back as a single-cell selection.
    rerender({ documentKey: "doc", host: stableHost, commands, selection: selection("A1"), sheetName: "Data", dirtyGeneration: 0 });
    expect(hook.current.matchCount).toBe(3);
    expect(readRange).toHaveBeenCalledTimes(reads);
    // Replace all applies to the frozen window, not to the collapsed reveal cell.
    act(() => hook.current.changeReplacement("beta"));
    execute.mockClear();
    act(() => hook.current.replaceAll());
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { 0: { 0: { v: "beta" } }, 1: { 1: { v: "beta" } }, 2: { 0: { v: "beta" } } },
    });
    expect(hook.current.action).toEqual({ kind: "replacedAll", count: 3 });
  });

  it("re-scopes when the user moves the selection themselves", async () => {
    const readRange = vi
      .fn()
      .mockResolvedValueOnce(result([cell("alpha", 0, 0), cell("alpha", 1, 0), cell("alpha", 2, 0)]))
      .mockResolvedValueOnce(result([cell("alpha", 0, 2)]));
    const stableHost = host(readRange);
    const { result: hook, rerender, commands } = setup({ host: stableHost, selection: selection("A1", "A3") });
    await ready(hook);
    act(() => hook.current.changeQuery("alpha"));
    expect(hook.current.matchCount).toBe(3);
    rerender({ documentKey: "doc", host: stableHost, commands, selection: selection("C1"), sheetName: "Data", dirtyGeneration: 0 });
    await waitFor(() => expect(readRange).toHaveBeenCalledTimes(2));
    expect(readRange).toHaveBeenLastCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 0, startColumn: 2, endColumn: 2 },
    });
    await waitFor(() => expect(hook.current.matchCount).toBe(1));
  });

  it("resolves a renamed live sheet by id before looking the file bounds up", async () => {
    const readRange = vi.fn(async () => result([cell("alpha", 0, 0)]));
    const { result: hook } = setup({
      host: host(readRange),
      selection: { sheet: "Renamed", address: "A1" },
      sheetName: "Renamed",
      resolveSheetId: (liveName) => (liveName === "Renamed" ? "sheet-1" : undefined),
    });
    await ready(hook);
    expect(readRange).toHaveBeenCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    });
  });

  it("keeps a session-added sheet honestly unavailable when the file does not carry its id", async () => {
    const readRange = vi.fn(async () => result([]));
    const { result: hook } = setup({
      host: host(readRange),
      selection: { sheet: "Sheet2", address: "A1" },
      sheetName: "Sheet2",
      resolveSheetId: () => "session-2",
    });
    await waitFor(() => expect(hook.current.scan.kind).toBe("unavailable"));
    expect(readRange).not.toHaveBeenCalled();
  });

  it("reports a failed read and an unknown sheet honestly", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("sidecar down"));
    const { result: hook } = setup({}, failing);
    await waitFor(() => expect(hook.current.scan.kind).toBe("error"));
    expect(hook.current.matchCount).toBe(0);
    const unknown = renderHook((next: XlsxFindReplaceOptions) => useXlsxFindReplace(next), {
      initialProps: {
        documentKey: "doc",
        host: host(async () => result([])),
        commands: { execute: vi.fn(() => true) },
        selection: selection("A1"),
        sheetName: "Missing",
      },
    });
    await waitFor(() => expect(unknown.result.current.scan.kind).toBe("unavailable"));
    expect(unknown.result.current.matchCount).toBe(0);
  });
});

describe("useXlsxFindReplace actions", () => {
  async function twoMatches() {
    const readRange = async () =>
      result([cell("alpha", 0, 0), cell("alpha", 1, 1), cell("alpha", 2, 0, "=A1")]);
    const render = setup({ selection: selection("A1", "B3") }, readRange);
    await ready(render.result);
    act(() => render.result.current.changeQuery("alpha"));
    return render;
  }

  it("moves the grid onto matches and wraps around", async () => {
    const { result: hook, execute } = await twoMatches();
    expect(hook.current.currentIndex).toBe(-1);
    expect(hook.current.canFind).toBe(true);
    act(() => hook.current.findNext());
    expect(hook.current.currentIndex).toBe(0);
    expect(execute).toHaveBeenCalledWith("sheet.command.select-range", {
      unitId: `file-${SHA}`,
      subUnit: "sheet-1",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    });
    expect(execute).toHaveBeenCalledWith("sheet.command.scroll-to-cell", {
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    });
    act(() => hook.current.findPrevious());
    expect(hook.current.currentIndex).toBe(2);
    act(() => hook.current.findNext());
    expect(hook.current.currentIndex).toBe(0);
  });

  it("replaces the current match through the allowlisted range-values command", async () => {
    const { result: hook, execute } = await twoMatches();
    act(() => hook.current.findNext());
    act(() => hook.current.changeReplacement("beta"));
    execute.mockClear();
    act(() => hook.current.replace());
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { 0: { 0: { v: "beta" } } },
    });
    expect(hook.current.action).toEqual({ kind: "replaced" });
  });

  it("advances to the next match after a successful single replace", async () => {
    const readRange = async () => result([cell("a", 0, 0), cell("a", 1, 0)]);
    const { result: hook, execute } = setup({ selection: selection("A1", "A2") }, readRange);
    await ready(hook);
    act(() => hook.current.changeQuery("a"));
    expect(hook.current.matchCount).toBe(2);
    act(() => hook.current.findNext());
    act(() => hook.current.changeReplacement("aa"));
    execute.mockClear();
    act(() => hook.current.replace());
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { 0: { 0: { v: "aa" } } },
    });
    // The replacement still matches ("a" -> "aa") but the cursor moved on.
    expect(hook.current.currentIndex).toBe(1);
    execute.mockClear();
    act(() => hook.current.replace());
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { 1: { 0: { v: "aa" } } },
    });
    expect(hook.current.currentIndex).toBe(0);
  });

  it("never replaces a formula match", async () => {
    const { result: hook, execute } = await twoMatches();
    // The third read cell carries a formula: it matches on its displayed value
    // but a value write would be recalculated away, so it is not replaceable.
    const formulaIndex = hook.current.matches.findIndex((match) => match.text === "alpha" && !match.replaceable);
    expect(formulaIndex).toBe(2);
    expect(hook.current.replaceableCount).toBe(2);
    act(() => hook.current.findNext());
    act(() => hook.current.findNext());
    act(() => hook.current.findNext());
    expect(hook.current.currentIndex).toBe(formulaIndex);
    expect(hook.current.canReplace).toBe(false);
    execute.mockClear();
    act(() => hook.current.replace());
    expect(execute).not.toHaveBeenCalled();
    expect(hook.current.action).toEqual({ kind: "idle" });
  });

  it("replaces every writable match in one command and counts them", async () => {
    const { result: hook, execute } = await twoMatches();
    act(() => hook.current.changeReplacement("beta"));
    expect(hook.current.replaceableCount).toBe(2);
    execute.mockClear();
    act(() => hook.current.replaceAll());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: `file-${SHA}`,
      subUnitId: "sheet-1",
      value: { 0: { 0: { v: "beta" } }, 1: { 1: { v: "beta" } } },
    });
    expect(hook.current.action).toEqual({ kind: "replacedAll", count: 2 });
  });

  it("refuses a replace-all above the op bound without sending a command", async () => {
    const rows = 10_001;
    const readRange = async () =>
      result(Array.from({ length: rows }, (_, row) => cell("alpha", row, 0)));
    const { result: hook, execute } = setup(
      {
        selection: selection("A1", `A${rows}`),
        host: host(readRange, [{ id: "sheet-1", name: "Data", rowCount: rows, columnCount: 1 }]),
      },
      readRange,
    );
    await ready(hook);
    act(() => hook.current.changeQuery("alpha"));
    act(() => hook.current.changeReplacement("beta"));
    expect(hook.current.replaceableCount).toBe(rows);
    execute.mockClear();
    act(() => hook.current.replaceAll());
    expect(hook.current.action).toEqual({ kind: "limit", count: rows });
    expect(execute.mock.calls.filter(([id]) => id === "sheet.command.set-range-values")).toHaveLength(0);
  });

  it("reports a refused command instead of claiming a replacement", async () => {
    const { result: hook, execute } = await twoMatches();
    act(() => hook.current.findNext());
    act(() => hook.current.changeReplacement("beta"));
    execute.mockReturnValue(false);
    act(() => hook.current.replace());
    expect(hook.current.action).toEqual({ kind: "failed" });
  });

  it("survives a command service that throws for an unknown id", async () => {
    const { result: hook, execute } = await twoMatches();
    execute.mockImplementation(() => {
      throw new Error("command not registered");
    });
    act(() => hook.current.findNext());
    expect(hook.current.currentIndex).toBe(0);
    act(() => hook.current.changeReplacement("beta"));
    act(() => hook.current.replace());
    expect(hook.current.action).toEqual({ kind: "failed" });
  });
});
