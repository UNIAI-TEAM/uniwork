import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxSelection } from "../types";
import { XlsxStatusBar } from "./xlsx-status-bar";

const cell = (value: RendererRangeCell["value"], row = 0, column = 0): RendererRangeCell => ({ row, column, value });

const result = (cells: RendererRangeCell[], extra: Partial<RendererRangeResult> = {}): RendererRangeResult =>
  ({ cells, indexingComplete: true, indexedThroughRow: null, ...extra }) as RendererRangeResult;

function host(readRange: XlsxGridHostPort["readRange"]): XlsxGridHostPort {
  const file = {
    sessionId: "s-1",
    sheets: [{ id: "sheet-1", name: "Data", rowCount: 100, columnCount: 26 }],
  } as never;
  return { file, readRange };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const selection = (address: string, endAddress?: string): XlsxSelection => ({
  sheet: "Data",
  address,
  ...(endAddress === undefined ? {} : { endAddress }),
});

const snapshotOf = (cells: Record<string, { value: number | string | null; formula?: string }>): XlsxWorkbookSnapshot =>
  ({ revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells }] }) as unknown as XlsxWorkbookSnapshot;

const viNumber = (value: number) => value.toLocaleString("vi");

describe("XlsxStatusBar", () => {
  it("renders a bare inline row without chrome when inline", () => {
    render(<XlsxStatusBar documentKey="doc" selection={null} host={host(vi.fn())} inline />);
    const bar = screen.getByTestId("xlsx-status-bar");
    expect(bar).toHaveAttribute("role", "group");
    expect(bar.className).toContain("whitespace-nowrap");
    expect(bar.className).not.toMatch(/border|bg-|px-|flex-wrap/);
    expect(screen.getByTestId("xlsx-status-bar-empty")).toBeInTheDocument();
  });

  it("shows an honest empty state when nothing is selected", () => {
    render(<XlsxStatusBar documentKey="doc" selection={null} host={host(vi.fn())} />);
    expect(screen.getByTestId("xlsx-status-bar")).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-status-bar-empty")).toHaveTextContent("Chọn ô để xem tóm tắt.");
  });

  it("reads the current selection and shows the numeric summary", async () => {
    const readRange = vi.fn(async () => result([cell(1, 0, 0), cell(2, 0, 1), cell(3, 1, 0), cell(4, 1, 1)]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "B2")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    expect(readRange).toHaveBeenCalledWith({
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
    });
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(10)}`);
    expect(screen.getByTestId("xlsx-status-bar-average")).toHaveTextContent(`Trung bình: ${viNumber(2.5)}`);
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số đếm: 4");
    // Excel default status bar: Average, Count, Sum - in that order, no Min/Max.
    expect(screen.queryByTestId("xlsx-status-bar-min")).not.toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-status-bar-max")).not.toBeInTheDocument();
    expect(screen.getByTestId("xlsx-status-bar").textContent).toBe(
      `Trung bình: ${viNumber(2.5)}Số đếm: 4Tổng: ${viNumber(10)}`,
    );
  });

  it("formats large totals with the Vietnamese grouping", async () => {
    const readRange = vi.fn(async () => result([cell(1_250_000_000)]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent("Tổng: 1.250.000.000");
  });

  it("shows nothing for a single text cell, like Excel", async () => {
    const readRange = vi.fn(async () => result([cell("alpha")]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-single-value");
    expect(screen.queryByTestId("xlsx-status-bar-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-status-bar-no-values")).not.toBeInTheDocument();
  });

  it("shows nothing for any single cell, a number included, like Excel (review-design F8)", async () => {
    for (const value of [42, null]) {
      const readRange = vi.fn(async () => result(value === null ? [] : [cell(value)]));
      const view = render(<XlsxStatusBar documentKey="doc" selection={selection("B3", "B3")} host={host(readRange)} />);
      await screen.findByTestId("xlsx-status-bar-single-value");
      expect(screen.queryByTestId("xlsx-status-bar-sum")).not.toBeInTheDocument();
      expect(screen.queryByTestId("xlsx-status-bar-no-values")).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("shows only the count for a text-only selection", async () => {
    const readRange = vi.fn(async () => result([cell("alpha"), cell("beta")]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-count");
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số đếm: 2");
    expect(screen.queryByTestId("xlsx-status-bar-sum")).not.toBeInTheDocument();
  });

  it("shows Average, Count and Sum over the numbers for a mixed selection", async () => {
    const readRange = vi.fn(async () => result([cell(1, 0, 0), cell("two", 1, 0), cell(3, 2, 0)]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A3")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-count");
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số đếm: 3");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(4)}`);
    expect(screen.getByTestId("xlsx-status-bar-average")).toHaveTextContent(`Trung bình: ${viNumber(2)}`);
  });

  it("keeps the previous summary visible while the next read is pending", async () => {
    const readRange = vi.fn(async () => result([cell(5)]));
    const stableHost = host(readRange);
    const { rerender } = render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={stableHost} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    const gate = deferred<RendererRangeResult>();
    readRange.mockImplementationOnce(() => gate.promise);
    rerender(<XlsxStatusBar documentKey="doc" selection={selection("B1", "B2")} host={stableHost} />);
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(5)}`);
    expect(screen.getByTestId("xlsx-status-bar-pending")).toBeInTheDocument();
    await act(async () => { gate.resolve(result([cell(9, 0, 1)])); await gate.promise; });
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(9)}`);
  });

  it("ignores a stale reply for an earlier selection", async () => {
    const first = deferred<RendererRangeResult>();
    const second = deferred<RendererRangeResult>();
    const readRange = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const stableHost = host(readRange);
    const { rerender } = render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={stableHost} />);
    rerender(<XlsxStatusBar documentKey="doc" selection={selection("B1", "B2")} host={stableHost} />);
    await act(async () => { second.resolve(result([cell(7, 0, 1)])); await second.promise; });
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(7)}`);
    await act(async () => { first.resolve(result([cell(1, 0, 0)])); await first.promise; });
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(7)}`);
  });

  it("re-reads the unchanged selection when the dirty generation changes", async () => {
    const gate = deferred<RendererRangeResult>();
    const readRange = vi.fn().mockResolvedValueOnce(result([cell(1)])).mockReturnValueOnce(gate.promise);
    const stableHost = host(readRange);
    const { rerender } = render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={stableHost} dirtyGeneration={0} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(1)}`);
    rerender(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={stableHost} dirtyGeneration={1} />);
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(1)}`);
    expect(screen.getByTestId("xlsx-status-bar-pending")).toBeInTheDocument();
    await act(async () => { gate.resolve(result([cell(6)])); await gate.promise; });
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(6)}`);
    expect(readRange).toHaveBeenNthCalledWith(2, {
      sessionId: "s-1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
    });
  });

  it("summarizes the live snapshot after an edit, not the frozen host read (F2)", async () => {
    const readRange = vi.fn(async () => result([cell(1_250_000_000)]));
    const stableHost = host(readRange);
    const before = snapshotOf({ B2: { value: 1_250_000_000 }, B3: { value: 1_410_000_000 }, B4: { value: 1_570_000_000 } });
    const { rerender } = render(
      <XlsxStatusBar documentKey="doc" selection={selection("B2", "B4")} host={stableHost} dirtyGeneration={0} snapshot={before} />,
    );
    await screen.findByTestId("xlsx-status-bar-sum");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(4_230_000_000)}`);
    // The host read is never consulted when a live snapshot is supplied.
    expect(readRange).not.toHaveBeenCalled();

    // B2 edited 1.25e9 -> 2e9 and a formula cell B5 added; the summary must
    // follow the new values and count the formula cell.
    const after = snapshotOf({
      B2: { value: 2_000_000_000 },
      B3: { value: 1_410_000_000 },
      B4: { value: 1_570_000_000 },
      B5: { value: 4_980_000_000, formula: "=SUM(B2:B4)" },
    });
    rerender(<XlsxStatusBar documentKey="doc" selection={selection("B2", "B5")} host={stableHost} dirtyGeneration={1} snapshot={after} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(9_960_000_000)}`);
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số đếm: 4");
  });

  it("reports a failed read without inventing values", async () => {
    const readRange = vi.fn().mockRejectedValueOnce(new Error("sidecar down"));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={host(readRange)} />);
    expect(await screen.findByTestId("xlsx-status-bar-error")).toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-status-bar-sum")).not.toBeInTheDocument();
  });

  it("stays unavailable without a renderer host or an unknown sheet", () => {
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1")} />);
    expect(screen.getByTestId("xlsx-status-bar-unavailable")).toBeInTheDocument();
    render(<XlsxStatusBar documentKey="doc" selection={{ sheet: "Missing", address: "A1" }} host={host(vi.fn())} />);
    expect(screen.getAllByTestId("xlsx-status-bar-unavailable")).toHaveLength(2);
  });

  it("marks a partially indexed read and sums only the confirmed rows", async () => {
    const readRange = vi.fn(async () => result([cell(1, 0), cell(2, 1), cell(3, 2)], { indexingComplete: false, indexedThroughRow: 0 }));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A3")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-partial");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(1)}`);
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số đếm: 1");
  });

  it("explains a partial read that confirms no values instead of a bare badge", async () => {
    const readRange = vi.fn(async () => result([], { indexingComplete: false, indexedThroughRow: null }));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A3")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-partial");
    expect(screen.getByTestId("xlsx-status-bar-partial-empty")).toHaveTextContent("Phần vùng chọn đã đọc không có giá trị.");
    expect(screen.queryByTestId("xlsx-status-bar-no-values")).not.toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-status-bar-sum")).not.toBeInTheDocument();
  });

  it("carries the partial hint in the badge for assistive tech", async () => {
    const readRange = vi.fn(async () => result([cell(1, 0)], { indexingComplete: false, indexedThroughRow: 0 }));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A3")} host={host(readRange)} />);
    const badge = await screen.findByTestId("xlsx-status-bar-partial");
    expect(badge).toHaveTextContent("Tóm tắt một phần");
    expect(badge).toHaveTextContent("Một phần vùng chọn nằm ngoài cửa sổ đọc, nên tổng chỉ tính trên các ô đã đọc.");
  });

  it("shows an empty state without reading when the selection is outside the used range", () => {
    const readRange = vi.fn();
    render(<XlsxStatusBar documentKey="doc" selection={selection("A200")} host={host(readRange)} />);
    // Outside the used bounds there is nothing to read at all: the request is
    // null and the bar shows the honest empty state, not a summary verdict.
    expect(screen.getByTestId("xlsx-status-bar-empty")).toBeInTheDocument();
    expect(readRange).not.toHaveBeenCalled();
  });

  it("does not read the host for a single cell, since its summary is never shown (review-delta-r2 X4)", async () => {
    const readRange = vi.fn(async () => result([cell(42)]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("B3", "B3")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-single-value");
    expect(readRange).not.toHaveBeenCalled();
  });

  it("treats one merged cell as a single cell, like Excel (review-delta-r2 X4)", async () => {
    const readRange = vi.fn(async () => result([cell(7, 0, 0)]));
    render(<XlsxStatusBar documentKey="doc" selection={{ ...selection("A1", "B2"), merged: true }} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-single-value");
    expect(screen.queryByTestId("xlsx-status-bar-sum")).not.toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-status-bar-count")).not.toBeInTheDocument();
    expect(readRange).not.toHaveBeenCalled();
  });

  it("still summarizes the same rectangle when it is not one merged cell", async () => {
    const readRange = vi.fn(async () => result([cell(7, 0, 0)]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "B2")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(7)}`);
  });

  it("localizes the summary with the active locale", async () => {
    await setLocale("en");
    const readRange = vi.fn(async () => result([cell(1010)]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Sum: ${(1010).toLocaleString("en")}`);
    expect(screen.getByTestId("xlsx-status-bar-average")).toHaveTextContent("Average: 1,010");
  });
});

function statusBarKeyPaths(dictionary: unknown): string[] {
  const statusBar = (dictionary as { office?: { xlsx?: { statusBar?: Record<string, unknown> } } })?.office?.xlsx?.statusBar ?? {};
  const paths: string[] = [];
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") paths.push(path);
      else if (value && typeof value === "object") walk(value as Record<string, unknown>, path);
    }
  };
  walk(statusBar, "");
  return paths.sort();
}

describe("status bar i18n", () => {
  it("carries the same status bar keys in vi and en", () => {
    const keys = statusBarKeyPaths(viLocale);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(statusBarKeyPaths(en));
  });
});
