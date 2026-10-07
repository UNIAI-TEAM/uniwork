import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useXlsxGridEdits } from "./use-xlsx-grid-edits";
import type { XlsxGridHostPort } from "./xlsx-grid-surface";
import type { XlsxEditorHandle, XlsxSaveCoordinator } from "./types";

describe("XLSX edit queue session ownership", () => {
  it("discards queued edits and stale dirty events when the same document receives a new editor", async () => {
    let release!: () => void;
    const delay = new Promise<void>((resolve) => { release = resolve; });
    const oldEdit = vi.fn(async () => delay);
    const oldEditor = { edit: oldEdit, getDirtyGeneration: () => 1 } as unknown as XlsxEditorHandle;
    const newEditor = { edit: vi.fn(async () => undefined), getDirtyGeneration: () => 0 } as unknown as XlsxEditorHandle;
    const coordinator = { markDirty: vi.fn() } as unknown as XlsxSaveCoordinator;
    const host = { file: { sheets: [{ id: "sheet-1", name: "Data" }] } } as XlsxGridHostPort;
    const applied = vi.fn();
    const hook = renderHook(({ editor }) => useXlsxGridEdits("same-document", editor, coordinator, host, true, applied), { initialProps: { editor: oldEditor } });
    act(() => {
      hook.result.current.onEdits([{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: 1 }]);
      hook.result.current.onEdits([{ sheetId: "sheet-1", row: 0, column: 1, writeValue: true, value: 2 }]);
    });
    await act(async () => { await Promise.resolve(); });
    expect(oldEdit).toHaveBeenCalledOnce();
    hook.rerender({ editor: newEditor });
    await act(async () => { release(); await delay; await hook.result.current.flush(); });
    expect(oldEdit).toHaveBeenCalledOnce();
    expect(newEditor.edit).not.toHaveBeenCalled();
    expect(coordinator.markDirty).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
  });
});

// review-design F3: a Data tool reads the snapshot only after the queued grid
// edits reached the editor, and fails when one of them failed.
describe("XLSX edit queue live snapshot", () => {
  it("answers the editor snapshot after the queued edits, and rejects after a failed one", async () => {
    let release!: () => void;
    const delay = new Promise<void>((resolve) => { release = resolve; });
    let value = "old";
    const edit = vi.fn(async () => { await delay; value = "typed"; });
    const editor = {
      edit,
      getDirtyGeneration: () => 1,
      getWorkbookSnapshot: () => ({ revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value } } }] }),
    } as unknown as XlsxEditorHandle;
    const coordinator = { markDirty: vi.fn() } as unknown as XlsxSaveCoordinator;
    const host = { file: { sheets: [{ id: "sheet-1", name: "Data" }] } } as XlsxGridHostPort;
    const hook = renderHook(() => useXlsxGridEdits("doc", editor, coordinator, host, true, vi.fn()));
    act(() => { hook.result.current.onEdits([{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: "typed" }]); });
    const read = hook.result.current.readLiveSnapshot();
    release();
    await expect(read).resolves.toMatchObject({ sheets: [{ cells: { A1: { value: "typed" } } }] });

    edit.mockImplementationOnce(async () => { throw new Error("edit failed"); });
    act(() => { hook.result.current.onEdits([{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: "x" }]); });
    await expect(hook.result.current.readLiveSnapshot()).rejects.toThrow("edit failed");
  });
});

// visual-final MAJOR 1: Undo of a Subtotal on a sheet with file CF/DV rules
// makes the grid emit ~30 edit batches in one command (row removals, rule-set
// re-snapshots, formula rewrites). Applied one by one, each published a
// snapshot and marked the document dirty in one microtask chain, which hit
// React's nested-update limit and failed the edit queue for the session.
describe("XLSX edit queue coalescing", () => {
  const host = { file: { sheets: [{ id: "sheet-1", name: "Data" }] } } as XlsxGridHostPort;
  const batch = (row: number) => [{ sheetId: "sheet-1", row, column: 0, writeValue: true, value: row }];

  it("applies the batches emitted before the queue drains as one ordered edit", async () => {
    const edit = vi.fn(async (_operations: readonly unknown[]) => undefined);
    const editor = { edit, getDirtyGeneration: () => 1 } as unknown as XlsxEditorHandle;
    const coordinator = { markDirty: vi.fn() } as unknown as XlsxSaveCoordinator;
    const applied = vi.fn();
    const hook = renderHook(() => useXlsxGridEdits("doc", editor, coordinator, host, true, applied));
    act(() => { for (let row = 0; row < 30; row += 1) hook.result.current.onEdits(batch(row)); });
    await act(async () => { await hook.result.current.flush(); });
    expect(edit).toHaveBeenCalledOnce();
    const operations = edit.mock.calls[0]![0] as { target: { cell: string } }[];
    expect(operations.map((operation) => operation.target.cell)).toEqual(Array.from({ length: 30 }, (_, row) => `A${row + 1}`));
    expect(coordinator.markDirty).toHaveBeenCalledOnce();
    expect(applied).toHaveBeenCalledOnce();

    // A batch emitted while the first edit is in flight waits for it, then goes alone.
    let release!: () => void;
    edit.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    act(() => { hook.result.current.onEdits(batch(40)); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => { hook.result.current.onEdits(batch(41)); hook.result.current.onEdits(batch(42)); });
    await act(async () => { release(); await hook.result.current.flush(); });
    expect(edit.mock.calls.map((call) => (call[0] as { target: { cell: string } }[]).map((operation) => operation.target.cell))).toEqual([
      Array.from({ length: 30 }, (_, row) => `A${row + 1}`), ["A41"], ["A42", "A43"],
    ]);
  });

});
