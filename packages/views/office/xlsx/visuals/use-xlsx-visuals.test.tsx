import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import type { XlsxSelection } from "../types";
import { XlsxVisualsProvider, useXlsxVisuals, type XlsxVisualsGrid, type XlsxVisualsOptions } from "./use-xlsx-visuals";
import { useXlsxVisualsCommands, type XlsxVisualsCommands } from "./visuals-context";

// A uniform fake grid: 64 x 20 px cells from (40, 24), zoom 1, sheet "s1" only.
const COL = 64;
const ROW = 20;
const fakeGrid = (values: (string | number | null)[][] = [["", "Q1"], ["North", 10], ["South", 20]]): XlsxVisualsGrid => ({
  getCellBox: (sheetId, row, column) => (sheetId === "s1" ? { x: 40 + column * COL, y: 24 + row * ROW, width: COL, height: ROW, zoom: 1 } : null),
  cellAtPoint: (sheetId, x, y) => {
    if (sheetId !== "s1") return null;
    const column = Math.max(0, Math.floor((x - 40) / COL));
    const row = Math.max(0, Math.floor((y - 24) / ROW));
    return { row, column, offsetX: x - 40 - column * COL, offsetY: y - 24 - row * ROW };
  },
  readRangeValues: () => ({ values, display: values.map((row) => row.map((cell) => (cell === null ? "" : String(cell)))) }),
});

const selection = (address = "A1", endAddress: string | null = "B3"): XlsxSelection => ({ sheet: "Data", address, ...(endAddress ? { endAddress } : {}) });

let commandsRef: XlsxVisualsCommands | null = null;
function Probe() {
  commandsRef = useXlsxVisualsCommands();
  return null;
}

function Harness({ grid, ...options }: Partial<XlsxVisualsOptions> & { grid: XlsxVisualsGrid | null }) {
  const gridRef = useRef<XlsxVisualsGrid | null>(grid);
  gridRef.current = grid;
  const visuals = useXlsxVisuals({
    gridRef,
    gridReady: true,
    selection: selection(),
    activeSheetId: "s1",
    activeSheetName: "Data",
    sheets: [{ id: "s1", name: "Data" }],
    canEdit: true,
    editor: options.editor ?? { edit: vi.fn(), getDirtyGeneration: () => 1 },
    savedGeneration: 0,
    onApplied: vi.fn(),
    onError: vi.fn(),
    ...options,
  });
  return (
    <XlsxVisualsProvider visuals={visuals}>
      <Probe />
      <div data-testid="surface" tabIndex={-1}>{visuals.overlay}</div>
    </XlsxVisualsProvider>
  );
}

function setup(overrides: Partial<XlsxVisualsOptions> & { grid?: XlsxVisualsGrid | null } = {}) {
  let generation = 0;
  const edit = vi.fn(async () => { generation += 1; });
  const onApplied = vi.fn();
  const onError = vi.fn();
  const editor = { edit, getDirtyGeneration: () => generation };
  const view = render(<Harness grid={overrides.grid === undefined ? fakeGrid() : overrides.grid} editor={editor} onApplied={onApplied} onError={onError} {...overrides} />);
  return { edit, onApplied, onError, view, editor, rerender: (next: Partial<XlsxVisualsOptions>) => view.rerender(<Harness grid={fakeGrid()} editor={editor} onApplied={onApplied} onError={onError} {...next} />) };
}

const lastOp = (edit: ReturnType<typeof vi.fn>) => (edit.mock.calls.at(-1)?.[0] as Record<string, unknown>[])[0] as {
  op: string;
  target: { sheet: string };
  attributes: Record<string, unknown> & { id: string; anchor: Record<string, number> };
};

beforeEach(async () => {
  commandsRef = null;
  await setLocale("en");
});

describe("useXlsxVisuals", () => {
  it("inserts a chart from the selected range beside it and draws it in the overlay", async () => {
    const { edit, onApplied } = setup();
    expect(commandsRef?.available).toBe(true);
    expect(commandsRef?.canInsertChart).toBe(true);
    act(() => commandsRef?.insertChart("column"));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    const op = lastOp(edit);
    expect(op.op).toBe("set_visual");
    expect(op.target.sheet).toBe("Data");
    expect(op.attributes.anchor).toMatchObject({ fromRow: 0, fromColumn: 2, fromRowOffset: 0, fromColumnOffset: 0 });
    expect(op.attributes.chart).toMatchObject({
      chartType: "column",
      title: "Q1",
      series: [{ name: "Q1", categories: ["North", "South"], values: [10, 20], valuesRef: "'Data'!$B$2:$B$3" }],
    });
    expect(await screen.findByTestId("xlsx-visual-item-chart")).toHaveAccessibleName("Column chart Q1");
  });

  it("explains instead of inserting when the range has no numbers", () => {
    const { edit, onError } = setup({ grid: fakeGrid([["a", "b"], ["c", "d"]]) });
    act(() => commandsRef?.insertChart("pie"));
    expect(edit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("The selected range has no numbers to chart.");
  });

  it("needs a multi-cell selection for a chart", () => {
    setup({ selection: selection("B2", null) });
    expect(commandsRef?.available).toBe(true);
    expect(commandsRef?.canInsertChart).toBe(false);
  });

  it("inserts a shape at the active cell with the default fill, and a line without one", async () => {
    const { edit } = setup({ selection: selection("B2", null) });
    act(() => commandsRef?.insertShape("ellipse"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(lastOp(edit).attributes.shape).toEqual({ shapeType: "ellipse", fillColor: "#4472C4" });
    expect(lastOp(edit).attributes.anchor).toMatchObject({ fromRow: 1, fromColumn: 1 });
    act(() => commandsRef?.insertShape("line"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(lastOp(edit).attributes.shape).toEqual({ shapeType: "line" });
  });

  it("moves with the keyboard and deletes under the same id", async () => {
    const { edit } = setup();
    act(() => commandsRef?.insertShape("rect"));
    const item = await screen.findByTestId("xlsx-visual-item-shape");
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    const id = lastOp(edit).attributes.id;
    fireEvent.keyDown(item, { key: "ArrowRight" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(lastOp(edit)).toMatchObject({ op: "set_visual", attributes: { id, anchor: { fromColumn: 0, fromColumnOffset: 8 * 9525 } } });
    // A move is anchor-only: the body rode the insert once.
    expect(Object.keys(lastOp(edit).attributes).sort()).toEqual(["anchor", "id"]);
    fireEvent.keyDown(item, { key: "Delete" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(3));
    expect(lastOp(edit)).toEqual({ op: "remove_visual", target: { sheet: "Data" }, attributes: { id } });
    expect(screen.queryByTestId("xlsx-visual-item-shape")).not.toBeInTheDocument();
  });

  it("restores the overlay and reports the error when an edit is refused", async () => {
    const onError = vi.fn();
    const edit = vi.fn(async () => { throw new Error("refused"); });
    render(<Harness grid={fakeGrid()} editor={{ edit, getDirtyGeneration: () => 0 }} onError={onError} />);
    act(() => commandsRef?.insertShape("rect"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("refused"));
    expect(screen.queryByTestId("xlsx-visual-item-shape")).not.toBeInTheDocument();
  });

  it("locks a visual once a save covers its last op", async () => {
    const { edit, rerender } = setup();
    act(() => commandsRef?.insertShape("rect"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    rerender({ savedGeneration: 1 });
    const item = await screen.findByTestId("xlsx-visual-item-shape");
    expect(item).toHaveAccessibleDescription("Saved to the file. Saved drawings cannot be edited yet.");
    fireEvent.keyDown(item, { key: "Delete" });
    fireEvent.keyDown(item, { key: "ArrowDown" });
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it.each(["ArrowDown", "Delete"])("does not %s a visual while a save is in flight, then locks it once the save lands", async (key) => {
    const { edit, rerender } = setup();
    act(() => commandsRef?.insertShape("rect"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    rerender({ saving: true });
    const item = await screen.findByTestId("xlsx-visual-item-shape");
    fireEvent.keyDown(item, { key });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("xlsx-visual-handle-se")).not.toBeInTheDocument();
    rerender({ saving: false, savedGeneration: 1 });
    expect(await screen.findByTestId("xlsx-visual-item-shape")).toHaveAccessibleDescription("Saved to the file. Saved drawings cannot be edited yet.");
    fireEvent.keyDown(screen.getByTestId("xlsx-visual-item-shape"), { key });
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("offers no insert while a save is in flight, and offers it again after", () => {
    const { edit, rerender } = setup({ saving: true });
    expect(commandsRef?.available).toBe(false);
    expect(commandsRef?.canInsertChart).toBe(false);
    act(() => commandsRef?.insertShape("rect"));
    expect(edit).not.toHaveBeenCalled();
    rerender({ saving: false });
    expect(commandsRef?.available).toBe(true);
  });

  it("reads a bounded slice of a whole-column selection and trims its empty tail", async () => {
    const values = [["", "Q1"], ["North", 10], ["South", 20]];
    const readRangeValues = vi.fn((_sheetId: string, range: { startRow: number; endRow: number; startColumn: number; endColumn: number }) => {
      const rows = Array.from({ length: range.endRow - range.startRow + 1 }, (_, row) =>
        Array.from({ length: range.endColumn - range.startColumn + 1 }, (_, column) => values[row]?.[column] ?? null));
      return { values: rows, display: rows.map((row) => row.map((cell) => (cell === null ? "" : String(cell)))) };
    });
    const { edit, onError } = setup({ grid: { ...fakeGrid(), readRangeValues }, selection: selection("A1", "B1048576") });
    act(() => commandsRef?.insertChart("column"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(readRangeValues).toHaveBeenCalledWith("s1", expect.objectContaining({ startRow: 0, endRow: 1_000, startColumn: 0, endColumn: 1 }));
    expect(lastOp(edit).attributes.chart).toMatchObject({ series: [{ values: [10, 20], valuesRef: "'Data'!$B$2:$B$3" }] });
    expect(onError).not.toHaveBeenCalled();
  });

  it("says so when the chart had to leave part of a large selection out", async () => {
    const readRangeValues = vi.fn((_sheetId: string, range: { startRow: number; endRow: number; startColumn: number; endColumn: number }) => {
      const rows = Array.from({ length: range.endRow - range.startRow + 1 }, (_, row) => [row === 0 ? "Q1" : row]);
      return { values: rows, display: rows.map((row) => row.map(String)) };
    });
    const { edit, onError } = setup({ grid: { ...fakeGrid(), readRangeValues }, selection: selection("A1", "A5000") });
    act(() => commandsRef?.insertChart("line"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith("The chart uses only the first 1,000 rows and 24 series of the selection.");
  });

  it("draws the visuals a recovered draft stream carries, and never resurrects one deleted here", async () => {
    const recoveredAnchor = { fromRow: 2, fromColumn: 1, fromRowOffset: 0, fromColumnOffset: 0, toRow: 5, toColumn: 3, toRowOffset: 0, toColumnOffset: 0 };
    const pendingOps = [{ op: "set_visual", target: { sheet: "Data" }, attributes: { id: "vr1", anchor: recoveredAnchor, shape: { shapeType: "ellipse" } } }];
    const { edit, rerender } = setup({ snapshot: { revision: 3, sheets: [], pendingOps } });
    const item = await screen.findByTestId("xlsx-visual-item-shape");
    expect(item).toHaveAccessibleName("Shape: Oval");
    // It moves and deletes like any session visual (anchor-only move, same id).
    fireEvent.keyDown(item, { key: "ArrowDown" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(lastOp(edit)).toMatchObject({ op: "set_visual", attributes: { id: "vr1" } });
    expect(Object.keys(lastOp(edit).attributes).sort()).toEqual(["anchor", "id"]);
    fireEvent.keyDown(screen.getByTestId("xlsx-visual-item-shape"), { key: "Delete" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    // A later snapshot whose stream still lists it does not bring it back.
    rerender({ snapshot: { revision: 4, sheets: [], pendingOps: [...pendingOps] } });
    expect(screen.queryByTestId("xlsx-visual-item-shape")).not.toBeInTheDocument();
  });

  it("inserts a picked picture keeping its aspect ratio and refuses other files", async () => {
    const { edit, onError } = setup({ selection: selection("A1", null) });
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 128);
    new DataView(png.buffer).setUint32(20, 64);
    const input = screen.getByTestId("xlsx-visual-picture-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([png], "p.png", { type: "image/png" })] } });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    const op = lastOp(edit);
    expect(op.attributes.image).toMatchObject({ mediaType: "image/png" });
    // 128 x 64 px from A1: two columns wide, three rows plus 4 px tall.
    expect(op.attributes.anchor).toEqual({
      fromRow: 0, fromColumn: 0, fromRowOffset: 0, fromColumnOffset: 0,
      toRow: 3, toColumn: 2, toRowOffset: 4 * 9525, toColumnOffset: 0,
    });
    fireEvent.change(input, { target: { files: [new File(["x"], "p.bmp", { type: "image/bmp" })] } });
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Only PNG, JPEG or GIF pictures can be inserted."));
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("offers nothing without an edit channel, a live grid or the geometry seam", () => {
    setup({ canEdit: false });
    expect(commandsRef?.available).toBe(false);
    setup({ grid: {} });
    expect(commandsRef?.available).toBe(false);
  });
});
