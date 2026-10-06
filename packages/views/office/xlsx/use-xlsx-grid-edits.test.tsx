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
