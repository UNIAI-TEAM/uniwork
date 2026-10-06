import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { XLSX_CLIENT_MAX_EDIT_OPS } from "./xlsx-clipboard";
import { useXlsxEditorClipboard, type XlsxEditorClipboardOptions } from "./use-xlsx-editor-clipboard";
import type { XlsxEditorHandle } from "./types";
import type { XlsxGridHandle, XlsxGridHostPort } from "./xlsx-grid-surface";

const TABLE = `<table><tr><td style="font-weight:bold">a</td><td style='mso-number-format:"0\\.00%"'>0.5</td></tr></table>`;

function setClipboardHtml(html: string | null) {
  const read = html === null
    ? undefined
    : vi.fn(async () => [{ types: ["text/html"], getType: async () => ({ text: async () => html }) }]);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: read ? { read } : undefined });
}

function setup(text: string) {
  const setCellText = vi.fn();
  const execute = vi.fn(async () => true);
  const setRecalcError = vi.fn();
  const options = {
    editor: { clipboard: { readText: async () => text } } as unknown as XlsxEditorHandle,
    permissions: {},
    selection: { sheet: "Data", address: "B2" },
    snapshot: null,
    canEdit: true,
    readOnly: false,
    rendererHost: { file: { sha256: "sha", sheets: [{ id: "s1", name: "Data" }] } } as unknown as XlsxGridHostPort,
    gridReady: true,
    gridRef: { current: { setCellText } as unknown as XlsxGridHandle },
    gridEdits: { flush: async () => undefined },
    gridCommands: { execute },
    mountRef: { current: {} },
    disposedRef: { current: false },
    markDirty: vi.fn(),
    refreshSnapshot: vi.fn(),
    setFormulaDraft: vi.fn(),
    setRecalcError,
  } satisfies XlsxEditorClipboardOptions;
  const hook = renderHook(() => useXlsxEditorClipboard(options));
  return { hook, setCellText, execute, setRecalcError };
}

describe("rich paste", () => {
  afterEach(() => setClipboardHtml(null));

  it("keeps bold and the number format of a pasted HTML table", async () => {
    setClipboardHtml(TABLE);
    const { hook, setCellText, execute, setRecalcError } = setup("a\t0.5");
    await act(async () => { await hook.result.current.paste(); });
    expect(setCellText).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: "file-sha", subUnitId: "s1", value: { 1: { 1: { s: { bl: 1 } } } },
    });
    expect(execute).toHaveBeenCalledWith("sheet.command.numfmt.set.numfmt", { values: [{ row: 1, col: 2, pattern: "0.00%" }] });
    expect(setRecalcError).not.toHaveBeenCalled();
  });

  it("pastes values only, without a notice, when no HTML is on the clipboard", async () => {
    setClipboardHtml(null);
    const { hook, setCellText, execute, setRecalcError } = setup("a\t0.5");
    await act(async () => { await hook.result.current.paste(); });
    expect(setCellText).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(setRecalcError).not.toHaveBeenCalled();
  });

  it("degrades an over-limit formatted paste to values with a visible notice", async () => {
    const cells = XLSX_CLIENT_MAX_EDIT_OPS / 2 + 1;
    setClipboardHtml(`<table><tr>${"<td style='font-weight:bold'>x</td>".repeat(cells)}</tr></table>`);
    const { hook, setCellText, execute, setRecalcError } = setup(Array.from({ length: cells }, () => "x").join("\t"));
    await act(async () => { await hook.result.current.paste(); });
    expect(setCellText).toHaveBeenCalledTimes(cells);
    expect(execute).not.toHaveBeenCalled();
    expect(setRecalcError).toHaveBeenCalledWith("Không giữ được định dạng khi dán nên chỉ dán giá trị.");
  });

  it("tells the user when the renderer refuses the format writes", async () => {
    setClipboardHtml(TABLE);
    const { hook, execute, setRecalcError } = setup("a\t0.5");
    execute.mockResolvedValue(false);
    await act(async () => { await hook.result.current.paste(); });
    expect(setRecalcError).toHaveBeenCalledWith("Không giữ được định dạng khi dán nên chỉ dán giá trị.");
  });
});
