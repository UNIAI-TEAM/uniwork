// UNI-940 X02: the grid surface's overlay mount and geometry pass-through.
import { render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { XlsxGridSurface, type XlsxGridHandle, type XlsxGridHostPort, type XlsxRendererModule } from "../xlsx-grid-surface";

const host: XlsxGridHostPort = {
  file: { sessionId: "s-1", name: "book.xlsx", sha256: "d".repeat(64), sheets: [{ id: "sheet-1", name: "Data", rowCount: 10, columnCount: 5 }], styles: [] } as never,
  async readRange() {
    return { cells: [], rows: [], merges: [], hyperlinks: [] } as never;
  },
};

function fakeModule(geometry: boolean) {
  const base: XlsxGridHandle = {
    loadWorkbook: vi.fn().mockResolvedValue(undefined),
    refreshViewport: vi.fn(),
    revealCell: vi.fn().mockResolvedValue(undefined),
    setCellText: vi.fn(),
    commitEdit: vi.fn(async () => undefined),
    selectSheet: vi.fn(),
    setNumberFormat: vi.fn(),
    executeCommand: vi.fn(() => true),
    getActiveFormatState: vi.fn(() => null),
    setDarkMode: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    getDirtyGeneration: vi.fn(() => 0),
    dispose: vi.fn(),
  };
  const handle: XlsxGridHandle = geometry
    ? {
        ...base,
        getCellBox: vi.fn(() => ({ x: 1, y: 2, width: 3, height: 4, zoom: 1 })),
        cellAtPoint: vi.fn(() => ({ row: 5, column: 6, offsetX: 7, offsetY: 8 })),
        readRangeValues: vi.fn(() => ({ values: [[1]], display: [["1"]] })),
      }
    : base;
  const options: { current: Parameters<XlsxRendererModule["createXlsxRenderer"]>[0] | null } = { current: null };
  const module: XlsxRendererModule = {
    installXlsxRendererStyles: vi.fn(),
    createXlsxRenderer: vi.fn((opts) => {
      options.current = opts;
      return handle;
    }),
  };
  return { module, options };
}

describe("XlsxGridSurface visuals seam", () => {
  it("draws the overlay inside the grid surface and forwards viewport changes", async () => {
    const { module, options } = fakeModule(true);
    const onViewportChange = vi.fn();
    render(
      <XlsxGridSurface
        documentKey="visuals-doc"
        host={host}
        loadModule={async () => module}
        overlay={<div data-testid="overlay-probe" />}
        onViewportChange={onViewportChange}
      />,
    );
    expect(screen.getByTestId("xlsx-grid-surface")).toContainElement(screen.getByTestId("overlay-probe"));
    await waitFor(() => expect(options.current).not.toBeNull());
    options.current?.onViewportChange?.();
    expect(onViewportChange).toHaveBeenCalledTimes(1);
  });

  it("passes the renderer geometry through the imperative handle", async () => {
    const { module } = fakeModule(true);
    const ref = createRef<XlsxGridHandle>();
    const onReady = vi.fn();
    render(<XlsxGridSurface ref={ref} documentKey="geo-doc" host={host} loadModule={async () => module} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(ref.current?.getCellBox?.("sheet-1", 0, 0)).toEqual({ x: 1, y: 2, width: 3, height: 4, zoom: 1 });
    expect(ref.current?.cellAtPoint?.("sheet-1", 10, 10)).toEqual({ row: 5, column: 6, offsetX: 7, offsetY: 8 });
    expect(ref.current?.readRangeValues?.("sheet-1", { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 })).toEqual({ values: [[1]], display: [["1"]] });
  });

  it("answers null when the renderer has no geometry seam", async () => {
    const { module } = fakeModule(false);
    const ref = createRef<XlsxGridHandle>();
    const onReady = vi.fn();
    render(<XlsxGridSurface ref={ref} documentKey="old-doc" host={host} loadModule={async () => module} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(ref.current?.getCellBox?.("sheet-1", 0, 0)).toBeNull();
    expect(ref.current?.cellAtPoint?.("sheet-1", 0, 0)).toBeNull();
    expect(ref.current?.readRangeValues?.("sheet-1", { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 })).toBeNull();
  });
});
