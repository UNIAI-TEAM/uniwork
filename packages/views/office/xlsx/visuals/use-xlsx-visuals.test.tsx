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

const ANCHOR = { fromRow: 1, fromColumn: 1, fromRowOffset: 0, fromColumnOffset: 0, toRow: 5, toColumn: 4, toRowOffset: 0, toColumnOffset: 0 };
/** Sheet s1's drawing: a chart, a picture past the preview cap, a fixed
 *  oneCellAnchor picture (100 x 50 px) and an undrawable group. */
const FILE_VISUALS: NonNullable<XlsxVisualsOptions["fileVisuals"]> = {
  s1: [
    { index: 0, kind: "chart", editable: true, anchor: ANCHOR, chart: { chartType: "column", title: "Sales", series: [{ name: "Q1", categories: ["N"], values: [1] }] }, chartTitle: "Sales" },
    { index: 1, kind: "picture", editable: true, anchor: { ...ANCHOR, fromRow: 8, toRow: 12 } },
    { index: 2, kind: "picture", editable: false, anchor: { ...ANCHOR, fromColumn: 3, toColumn: 3 }, extent: { cx: 952500, cy: 476250 }, image: { mediaType: "image/png", base64: "AAAA" } },
    { index: 3, kind: "other", editable: false, anchor: ANCHOR },
  ],
};

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

  it("keeps a visual editable once a save wrote it, addressing it by its file index", async () => {
    const { edit, rerender } = setup();
    act(() => commandsRef?.insertShape("rect"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    rerender({ savedGeneration: 1 });
    const item = await screen.findByTestId("xlsx-visual-item-shape");
    expect(item).toHaveAccessibleDescription(/Arrow keys move it/);
    fireEvent.keyDown(item, { key: "ArrowDown" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(lastOp(edit)).toMatchObject({ op: "set_visual", attributes: { file: 0 } });
    expect(Object.keys(lastOp(edit).attributes).sort()).toEqual(["anchor", "file"]);
    fireEvent.keyDown(screen.getByTestId("xlsx-visual-item-shape"), { key: "Delete" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(3));
    expect(lastOp(edit)).toEqual({ op: "remove_visual", target: { sheet: "Data" }, attributes: { file: 0 } });
  });

  it.each(["ArrowDown", "Delete"])("does not %s a visual while a save is in flight, then edits it by file index once the save lands", async (key) => {
    const { edit, rerender } = setup();
    act(() => commandsRef?.insertShape("rect"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    rerender({ saving: true });
    const item = await screen.findByTestId("xlsx-visual-item-shape");
    fireEvent.keyDown(item, { key });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("xlsx-visual-handle-se")).not.toBeInTheDocument();
    expect(item).toHaveAccessibleDescription(/a save is in progress/);
    rerender({ saving: false, savedGeneration: 1 });
    fireEvent.keyDown(await screen.findByTestId("xlsx-visual-item-shape"), { key });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(lastOp(edit).attributes.file).toBe(0);
  });

  it("draws the file's own visuals, edits them by index and leaves fixed and undrawable ones alone", async () => {
    const { edit } = setup({ fileVisuals: FILE_VISUALS });
    expect(await screen.findByTestId("xlsx-visual-item-chart")).toHaveAccessibleName("Column chart Sales");
    expect(screen.getAllByTestId("xlsx-visual-item-picture")).toHaveLength(2);
    const pictures = screen.getAllByTestId("xlsx-visual-item-picture");
    // index 2: oneCellAnchor, drawn from its start cell plus its EMU extent.
    const fixed = pictures.find((item) => item.getAttribute("data-visual-id") === "file-s1-2")!;
    expect(fixed.style.left).toBe(`${40 + 3 * COL}px`);
    expect(fixed.style.width).toBe("100px");
    expect(fixed).toHaveAccessibleDescription(/cannot move yet/);
    fireEvent.keyDown(fixed, { key: "ArrowRight" });
    fireEvent.keyDown(fixed, { key: "Delete" });
    expect(edit).not.toHaveBeenCalled();
    // index 1: a picture past the preview cap is a placeholder, still movable.
    expect(screen.getByText("This picture is too large to preview here.")).toBeInTheDocument();
    // index 3 ("other") is never drawn.
    expect(document.querySelector('[data-visual-id="file-s1-3"]')).toBeNull();
    fireEvent.keyDown(screen.getByTestId("xlsx-visual-item-chart"), { key: "ArrowDown" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(lastOp(edit)).toMatchObject({ op: "set_visual", target: { sheet: "Data" }, attributes: { file: 0, anchor: { fromRow: 1 } } });
  });

  it("renumbers after a save: a deleted file visual's later anchors move up, then the visuals it wrote append", async () => {
    const { edit, rerender } = setup({ fileVisuals: FILE_VISUALS });
    fireEvent.keyDown(await screen.findByTestId("xlsx-visual-item-chart"), { key: "Delete" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(lastOp(edit)).toEqual({ op: "remove_visual", target: { sheet: "Data" }, attributes: { file: 0 } });
    act(() => commandsRef?.insertShape("ellipse"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    rerender({ fileVisuals: FILE_VISUALS, savedGeneration: 2 });
    // File 0 left: the pictures (1, 2) and the hidden "other" (3) move up to
    // 0..2, and the saved ellipse takes index 3.
    const shape = await screen.findByTestId("xlsx-visual-item-shape");
    fireEvent.keyDown(shape, { key: "ArrowDown" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(3));
    expect(lastOp(edit).attributes.file).toBe(3);
    const big = screen.getAllByTestId("xlsx-visual-item-picture").find((item) => item.getAttribute("data-visual-id") === "file-s1-1")!;
    fireEvent.keyDown(big, { key: "Delete" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(4));
    expect(lastOp(edit).attributes).toEqual({ file: 0 });
  });

  it("applies the file edits a recovered draft carries once, and its saved delete renumbers the rest", async () => {
    const stream = [
      { op: "set_visual", target: { sheet: "Data" }, attributes: { file: 0, anchor: { ...ANCHOR, fromRow: 6, toRow: 9 } } },
      { op: "remove_visual", target: { sheet: "Data" }, attributes: { file: 1 } },
    ];
    const { edit, rerender } = setup({ fileVisuals: FILE_VISUALS, snapshot: { pendingOps: stream } });
    const chart = await screen.findByTestId("xlsx-visual-item-chart");
    expect(chart.style.top).toBe(`${24 + 6 * ROW}px`);
    expect(document.querySelector('[data-visual-id="file-s1-1"]')).toBeNull();
    // Save 1 carried the recovered delete of file 1: the fixed picture and
    // the hidden group move up to 1 and 2.
    rerender({ fileVisuals: FILE_VISUALS, snapshot: { pendingOps: [] }, savedGeneration: 1 });
    act(() => commandsRef?.insertShape("rect"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    rerender({ fileVisuals: FILE_VISUALS, snapshot: { pendingOps: [] }, savedGeneration: 2 });
    fireEvent.keyDown(await screen.findByTestId("xlsx-visual-item-shape"), { key: "ArrowDown" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(lastOp(edit).attributes.file).toBe(3);
  });

  it("still inserts while a save is in flight; the new visual moves only once that save lands, and stays editable", async () => {
    const { edit, rerender } = setup({ saving: true });
    expect(commandsRef?.available).toBe(true);
    act(() => commandsRef?.insertShape("rect"));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(lastOp(edit).attributes.shape).toEqual({ shapeType: "rect", fillColor: "#4472C4" });
    // Moves stay frozen while the save runs.
    fireEvent.keyDown(await screen.findByTestId("xlsx-visual-item-shape"), { key: "ArrowDown" });
    expect(edit).toHaveBeenCalledTimes(1);
    // The save covered generation 0, before this insert (generation 1): not locked.
    rerender({ saving: false, savedGeneration: 0 });
    fireEvent.keyDown(screen.getByTestId("xlsx-visual-item-shape"), { key: "ArrowDown" });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(Object.keys(lastOp(edit).attributes).sort()).toEqual(["anchor", "id"]);
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
