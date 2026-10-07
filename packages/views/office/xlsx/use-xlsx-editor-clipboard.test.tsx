import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { XLSX_CLIENT_MAX_EDIT_OPS } from "./xlsx-clipboard";
import { useXlsxEditorClipboard, type XlsxEditorClipboardOptions } from "./use-xlsx-editor-clipboard";
import type { XlsxEditorHandle } from "./types";
import type { XlsxGridHandle, XlsxGridHostPort } from "./xlsx-grid-surface";

const TABLE = `<table><tr><td style="font-weight:bold">a</td><td x:num="0.5" style='mso-number-format:"0\\.00%"'>50.00%</td></tr></table>`;
const NOTICE = "Không giữ được định dạng khi dán nên chỉ dán giá trị.";
const MERGES_NOTICE = "Không giữ được ô gộp khi dán. Giá trị và định dạng đã được dán.";

function setClipboard(flavours: Record<string, string> | null) {
  const read = flavours === null
    ? undefined
    : vi.fn(async () => [{ types: Object.keys(flavours), getType: async (type: string) => ({ text: async () => flavours[type]! }) }]);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: read ? { read } : undefined });
  return read;
}

function setup(text: string, overrides: Partial<XlsxEditorClipboardOptions> = {}, batch?: (steps: readonly { id: string; params?: unknown }[]) => Promise<number>) {
  const setCellText = vi.fn();
  const execute = vi.fn(async (_id: string, _params?: unknown) => true);
  const setRecalcError = vi.fn();
  const readText = vi.fn(async () => text);
  const edit = vi.fn();
  const options = {
    editor: { clipboard: { readText }, edit } as unknown as XlsxEditorHandle,
    permissions: {},
    selection: { sheet: "Data", address: "B2" },
    snapshot: null,
    canEdit: true,
    readOnly: false,
    rendererHost: { file: { sha256: "sha", sheets: [{ id: "s1", name: "Data" }] } } as unknown as XlsxGridHostPort,
    gridReady: true,
    gridRef: { current: { setCellText, ...(batch ? { executeCommandsAsOneStep: batch } : {}) } as unknown as XlsxGridHandle },
    gridEdits: { flush: async () => undefined },
    gridCommands: { execute },
    mountRef: { current: {} },
    disposedRef: { current: false },
    markDirty: vi.fn(),
    refreshSnapshot: vi.fn(),
    setFormulaDraft: vi.fn(),
    setRecalcError,
    ...overrides,
  } satisfies XlsxEditorClipboardOptions;
  const hook = renderHook(() => useXlsxEditorClipboard(options));
  return { hook, setCellText, execute, setRecalcError, readText, edit };
}

const S = { f: null, p: null, si: null };

describe("rich paste on the live grid", () => {
  afterEach(() => setClipboard(null));

  it("writes values and formats in one set-range-values, from ONE clipboard read", async () => {
    const read = setClipboard({ "text/plain": "a\t50.00%", "text/html": TABLE });
    const { hook, setCellText, execute, setRecalcError, readText } = setup("unused");
    await act(async () => { await hook.result.current.paste(); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(readText).not.toHaveBeenCalled();
    expect(setCellText).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: "file-sha", subUnitId: "s1", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 2 }, value: { 1: {
        1: { ...S, v: "a", t: 1, s: { bl: 1 } },
        2: { ...S, v: 0.5, t: 2, s: { n: { pattern: "0.00%" } } },
      } },
    });
    expect(setRecalcError).not.toHaveBeenCalled();
    expect(hook.result.current.pasteNotice).toBeNull();
  });

  it("runs values, formats and merges as one batched undo step when the grid can batch", async () => {
    setClipboard({ "text/plain": "a\t\tb", "text/html": "<table><tr><td colspan=2 style='font-style:italic'>a</td><td>b</td></tr></table>" });
    const batch = vi.fn(async (steps: readonly unknown[]) => steps.length);
    const { hook, execute } = setup("unused", {}, batch);
    await act(async () => { await hook.result.current.paste(); });
    expect(execute).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith([
      { id: "sheet.command.set-range-values", params: { unitId: "file-sha", subUnitId: "s1", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 }, value: { 1: {
        1: { ...S, v: "a", t: 1, s: { it: 1 } }, 2: { ...S, v: null }, 3: { ...S, v: "b", t: 1 },
      } } } },
      { id: "sheet.command.add-worksheet-merge", params: { unitId: "file-sha", subUnitId: "s1", selections: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 2 }], defaultMerge: true } },
    ]);
  });

  it("pastes plain values as one command, without a notice, when no HTML is on the clipboard", async () => {
    setClipboard(null);
    const { hook, execute, readText } = setup("a\t0.5");
    await act(async () => { await hook.result.current.paste(); });
    expect(readText).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: "file-sha", subUnitId: "s1", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 2 }, value: { 1: { 1: { ...S, v: "a", t: 1 }, 2: { ...S, v: 0.5, t: 2 } } },
    });
    expect(hook.result.current.pasteNotice).toBeNull();
  });

  it("ignores a stale HTML flavour whose text differs from the plain text", async () => {
    setClipboard({ "text/plain": "a\tother", "text/html": TABLE });
    const { hook, execute } = setup("unused");
    await act(async () => { await hook.result.current.paste(); });
    const params = execute.mock.calls[0]![1] as { value: Record<number, Record<number, { s?: unknown }>> };
    expect(params.value[1]![1]!.s).toBeUndefined();
    expect(hook.result.current.pasteNotice).toBeNull();
  });

  it("degrades an over-limit paste to values with a neutral notice that dismisses", async () => {
    // 2 values per row fit the bound; one merge op per row tips it over.
    const cells = Math.ceil(XLSX_CLIENT_MAX_EDIT_OPS / 3) + 1;
    const html = `<table>${"<tr><td colspan=2>x</td></tr>".repeat(cells)}</table>`;
    setClipboard({ "text/plain": Array.from({ length: cells }, () => "x\t").join("\n"), "text/html": html });
    const { hook, execute, setRecalcError } = setup("unused", { selection: { sheet: "Data", address: "A1" } });
    await act(async () => { await hook.result.current.paste(); });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(setRecalcError).not.toHaveBeenCalled();
    expect(hook.result.current.pasteNotice?.message).toBe(NOTICE);
    act(() => hook.result.current.pasteNotice!.dismiss());
    expect(hook.result.current.pasteNotice).toBeNull();
  });

  it("falls back to per-cell values and the notice when the renderer refuses the paste", async () => {
    setClipboard({ "text/plain": "a\t50.00%", "text/html": TABLE });
    const { hook, execute, setCellText, setRecalcError } = setup("unused");
    execute.mockResolvedValue(false);
    await act(async () => { await hook.result.current.paste(); });
    expect(setCellText).toHaveBeenCalledTimes(2);
    expect(setCellText).toHaveBeenCalledWith("s1", 1, 2, "50.00%");
    expect(setRecalcError).not.toHaveBeenCalled();
    expect(hook.result.current.pasteNotice?.message).toBe(NOTICE);
  });

  it("keeps a half-run batch as it is: no per-cell rewrite, a merges notice (F-P2)", async () => {
    setClipboard({ "text/plain": "a		b", "text/html": "<table><tr><td colspan=2 style='font-style:italic'>a</td><td>b</td></tr></table>" });
    // set-range-values ran, the merge was refused.
    const batch = vi.fn(async () => 1);
    const { hook, setCellText, setRecalcError } = setup("unused", {}, batch);
    await act(async () => { await hook.result.current.paste(); });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(setCellText).not.toHaveBeenCalled();
    expect(setRecalcError).not.toHaveBeenCalled();
    expect(hook.result.current.pasteNotice?.message).toBe(MERGES_NOTICE);
  });

  it("falls back to per-cell writes when the batch wrote nothing", async () => {
    setClipboard({ "text/plain": "a		b", "text/html": "<table><tr><td colspan=2 style='font-style:italic'>a</td><td>b</td></tr></table>" });
    const { hook, setCellText } = setup("unused", {}, vi.fn(async () => 0));
    await act(async () => { await hook.result.current.paste(); });
    expect(setCellText).toHaveBeenCalledTimes(3);
    expect(hook.result.current.pasteNotice?.message).toBe(NOTICE);
  });

  it("takes the HTML only from the item that holds the plain text (F-P5)", async () => {
    const items = [
      { types: ["text/html"], getType: async () => ({ text: async () => TABLE }) },
      { types: ["text/plain"], getType: async () => ({ text: async () => "a\t50.00%" }) },
    ];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: vi.fn(async () => items) } });
    const { hook, execute, readText } = setup("unused");
    await act(async () => { await hook.result.current.paste(); });
    expect(readText).not.toHaveBeenCalled();
    const params = execute.mock.calls[0]![1] as { value: Record<number, Record<number, { s?: unknown }>> };
    expect(params.value[1]![1]!.s).toBeUndefined();
    expect(params.value[1]![2]!.s).toBeUndefined();
  });

  it("falls back to the host port when the browser refuses the async read", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: vi.fn(async () => { throw new Error("denied"); }) } });
    const { hook, readText, execute } = setup("z");
    await act(async () => { await hook.result.current.paste(); });
    expect(readText).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("rich paste on the fallback surface", () => {
  afterEach(() => setClipboard(null));

  it("sends values, styles and merges in one edit batch", async () => {
    setClipboard({ "text/plain": "a\t\t50.00%", "text/html": `<table><tr><td colspan=2 style='color:#ff0000'>a</td><td x:num="0.5" style='mso-number-format:"0\\.00%"'>50.00%</td></tr></table>` });
    const { hook, edit, execute } = setup("unused", { gridReady: false, rendererHost: undefined });
    await act(async () => { await hook.result.current.paste(); });
    expect(execute).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith([
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: "a" }, style: { cl: { rgb: "#ff0000" } } },
      { op: "set_cell", target: { sheet: "Data", cell: "C2" }, attributes: { value: null } },
      { op: "set_cell", target: { sheet: "Data", cell: "D2" }, attributes: { value: 0.5 }, style: { n: { pattern: "0.00%" } } },
      { op: "merge_cells", target: { sheet: "Data" }, range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 2 } },
    ]);
  });
});
