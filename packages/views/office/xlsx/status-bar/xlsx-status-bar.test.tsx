import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
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

const viNumber = (value: number) => value.toLocaleString("vi");

describe("XlsxStatusBar", () => {
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
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số lượng: 4");
    expect(screen.getByTestId("xlsx-status-bar-min")).toHaveTextContent(`Nhỏ nhất: ${viNumber(1)}`);
    expect(screen.getByTestId("xlsx-status-bar-max")).toHaveTextContent(`Lớn nhất: ${viNumber(4)}`);
  });

  it("shows only the count for a text-only selection", async () => {
    const readRange = vi.fn(async () => result([cell("alpha"), cell("beta")]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A2")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-count");
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số lượng: 2");
    expect(screen.queryByTestId("xlsx-status-bar-sum")).not.toBeInTheDocument();
  });

  it("shows only the count for a mixed selection", async () => {
    const readRange = vi.fn(async () => result([cell(1, 0, 0), cell("two", 1, 0), cell(3, 2, 0)]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1", "A3")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-count");
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số lượng: 3");
    expect(screen.queryByTestId("xlsx-status-bar-sum")).not.toBeInTheDocument();
  });

  it("keeps the previous summary visible while the next read is pending", async () => {
    const readRange = vi.fn(async () => result([cell(5)]));
    const stableHost = host(readRange);
    const { rerender } = render(<XlsxStatusBar documentKey="doc" selection={selection("A1")} host={stableHost} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    const gate = deferred<RendererRangeResult>();
    readRange.mockImplementationOnce(() => gate.promise);
    rerender(<XlsxStatusBar documentKey="doc" selection={selection("B1")} host={stableHost} />);
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
    const { rerender } = render(<XlsxStatusBar documentKey="doc" selection={selection("A1")} host={stableHost} />);
    rerender(<XlsxStatusBar documentKey="doc" selection={selection("B1")} host={stableHost} />);
    await act(async () => { second.resolve(result([cell(7, 0, 1)])); await second.promise; });
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(7)}`);
    await act(async () => { first.resolve(result([cell(1, 0, 0)])); await first.promise; });
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Tổng: ${viNumber(7)}`);
  });

  it("reports a failed read without inventing values", async () => {
    const readRange = vi.fn().mockRejectedValueOnce(new Error("sidecar down"));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1")} host={host(readRange)} />);
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
    expect(screen.getByTestId("xlsx-status-bar-count")).toHaveTextContent("Số lượng: 1");
  });

  it("shows an empty state without reading when the selection is outside the used range", () => {
    const readRange = vi.fn();
    render(<XlsxStatusBar documentKey="doc" selection={selection("A200")} host={host(readRange)} />);
    expect(screen.getByTestId("xlsx-status-bar-no-values")).toBeInTheDocument();
    expect(readRange).not.toHaveBeenCalled();
  });

  it("localizes the summary with the active locale", async () => {
    await setLocale("en");
    const readRange = vi.fn(async () => result([cell(1010)]));
    render(<XlsxStatusBar documentKey="doc" selection={selection("A1")} host={host(readRange)} />);
    await screen.findByTestId("xlsx-status-bar-sum");
    expect(screen.getByTestId("xlsx-status-bar-sum")).toHaveTextContent(`Sum: ${(1010).toLocaleString("en")}`);
    expect(screen.getByTestId("xlsx-status-bar-max")).toHaveTextContent("Max: 1,010");
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
