import { describe, expect, it, vi } from "vitest";
import { createIpcDispatcher, IpcValidationError, PRINT_HTML_MAX_BYTES, validateIpcRequest } from "./ipc";
import { PRINT_PARTITION, PRINT_WINDOW_WEB_PREFERENCES, type PrintWindowOptions } from "./print";
import { toElectronPageRanges, type PreviewWindow } from "./print-preview";
import { createPrintSavePdfIpcHandler, printPdfFileName } from "./print-save-pdf";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const options = { landscape: true, pageSize: { width: 190_500, height: 338_658 } };
const request = { sessionGeneration: "session_1234", title: "Deck.pptx", html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'"></head><body><p>x</p></body></html>`, options };
const SAVE_PATH = "C:\\Users\\me\\Documents\\Deck.pdf";

describe("desktop:print-save-pdf validation", () => {
  it("accepts a sanitized copy with geometry and optional page spans from the bound app window", () => {
    expect(validateIpcRequest("desktop:print-save-pdf", request, context)).toEqual(request);
    const ranged = { ...request, options: { ...options, pageRanges: [{ from: 0, to: 2 }, { from: 4, to: 4 }] } };
    expect(validateIpcRequest("desktop:print-save-pdf", ranged, context)).toEqual(ranged);
  });
  it.each([
    ["another webContents", { ...context, senderId: 8 }, "sender"],
    ["a subframe", { ...context, frameId: 3 }, "frame"],
    ["a foreign origin", { ...context, origin: "https://evil.test" }, "origin"],
  ] as const)("refuses %s", (_label, sender, code) => {
    expect(() => validateIpcRequest("desktop:print-save-pdf", request, sender)).toThrowError(expect.objectContaining({ code }));
  });
  it("refuses a stale session", () => {
    expect(() => validateIpcRequest("desktop:print-save-pdf", { ...request, sessionGeneration: "session_9999" }, context)).toThrowError(IpcValidationError);
  });
  it.each([
    ["a non-string html", { ...request, html: 42 }],
    ["an empty copy", { ...request, html: "" }],
    ["missing options", { sessionGeneration: request.sessionGeneration, title: request.title, html: request.html }],
    ["an extra key", { ...request, extra: true }],
    ["a path in the payload", { ...request, path: "C:\\Windows\\evil.pdf" }],
    ["a path in the options", { ...request, options: { ...options, path: "C:\\Windows\\evil.pdf" } }],
    ["a file name in the options", { ...request, options: { ...options, filePath: "evil.pdf" } }],
    ["a silent job", { ...request, options: { ...options, silent: true, deviceName: "Office printer" } }],
    ["a backwards range", { ...request, options: { ...options, pageRanges: [{ from: 3, to: 1 }] } }],
    ["an empty range list", { ...request, options: { ...options, pageRanges: [] } }],
    ["a named size", { ...request, options: { landscape: false, pageSize: "A4" } }],
  ])("refuses %s", (_label, payload) => {
    expect(() => validateIpcRequest("desktop:print-save-pdf", payload, context)).toThrowError(IpcValidationError);
  });
  it("allows a copy above the control budget but refuses one over the print cap", () => {
    expect(() => validateIpcRequest("desktop:print-save-pdf", { ...request, html: "x".repeat(PRINT_HTML_MAX_BYTES) }, context)).not.toThrow();
    expect(() => validateIpcRequest("desktop:print-save-pdf", { ...request, html: "x".repeat(PRINT_HTML_MAX_BYTES + 1) }, context)).toThrowError(IpcValidationError);
  });
  it("passes the dispatcher's response check and fails closed on a malformed answer", async () => {
    for (const answer of [{ outcome: "saved" }, { outcome: "cancelled" }, { outcome: "failed", reason: "print_save_failed" }] as const) {
      const dispatch = createIpcDispatcher({ "desktop:print-save-pdf": async () => answer }, context);
      expect(await dispatch("desktop:print-save-pdf", request)).toEqual(answer);
    }
    const leaky = createIpcDispatcher({ "desktop:print-save-pdf": async () => ({ outcome: "saved", path: SAVE_PATH } as never) }, context);
    await expect(leaky("desktop:print-save-pdf", request)).rejects.toThrowError(IpcValidationError);
  });
});

describe("toElectronPageRanges and printPdfFileName", () => {
  it("writes 1-based Electron ranges from 0-based inclusive spans", () => {
    expect(toElectronPageRanges([{ from: 0, to: 2 }, { from: 4, to: 4 }])).toBe("1-3, 5");
    expect(toElectronPageRanges([{ from: 0, to: 0 }])).toBe("1");
    expect(toElectronPageRanges([{ from: 9, to: 11 }])).toBe("10-12");
  });
  it("derives the suggested file name from the title stem", () => {
    expect(printPdfFileName("Deck.pptx")).toBe("Deck.pdf");
    expect(printPdfFileName("Q3 report: final/v2.docx")).toBe("Q3 report final v2.pdf");
    expect(printPdfFileName("   ")).toBe("document.pdf");
    expect(printPdfFileName("..\\..\\evil")).not.toMatch(/[\\/]/);
  });
});

function fakeWindow(toPdf: () => Promise<Uint8Array>, load: () => Promise<void> = async () => undefined) {
  const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  let openHandler: (() => { action: "deny" }) | undefined;
  let destroyed = false;
  const window = {
    webContents: {
      setWindowOpenHandler: vi.fn((handler: () => { action: "deny" }) => { openHandler = handler; }),
      on: vi.fn((event: string, listener: (event: { preventDefault(): void }) => void) => { listeners.set(event, listener); }),
      print: vi.fn(),
      printToPDF: vi.fn((_options: object) => toPdf()),
    },
    loadFile: vi.fn(load),
    isDestroyed: () => destroyed,
    close: vi.fn(() => { destroyed = true; }),
  } satisfies PreviewWindow;
  return { window, listeners, openHandler: () => openHandler };
}

interface HarnessOptions {
  toPdf?: () => Promise<Uint8Array>;
  load?: () => Promise<void>;
  timeoutMs?: number;
  chooseSavePath?: (defaultName: string) => Promise<string | undefined>;
  writeOutput?: (path: string, bytes: Uint8Array) => Promise<void>;
}

function harness({ toPdf = async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]), load, timeoutMs, chooseSavePath, writeOutput }: HarnessOptions = {}) {
  const fake = fakeWindow(toPdf, load);
  const cleanup = vi.fn(async () => undefined);
  const writeFile = vi.fn(async (_html: string, fileName: string) => ({ path: `C:\\tmp\\uniwork-print\\job-1\\${fileName}`, cleanup }));
  const createWindow = vi.fn((_options: PrintWindowOptions) => fake.window);
  const choose = vi.fn(chooseSavePath ?? (async (_defaultName: string) => SAVE_PATH));
  const output = vi.fn(writeOutput ?? (async (_path: string, _bytes: Uint8Array) => undefined));
  const handler = createPrintSavePdfIpcHandler({ createWindow, writeFile, chooseSavePath: choose, writeOutput: output, ...(timeoutMs === undefined ? {} : { timeoutMs }) })["desktop:print-save-pdf"];
  return { ...fake, cleanup, writeFile, createWindow, choose, output, handler };
}

describe("desktop:print-save-pdf handler", () => {
  it("asks the path first, lays out the copy and writes the exact bytes to the chosen path", async () => {
    // A pooled Buffer view: the written bytes must not carry the unrelated pool memory.
    const pooled = Buffer.from("%PDF-1.7 saved");
    const { handler, choose, output, window, cleanup, writeFile } = harness({ toPdf: async () => pooled });
    expect(await handler(request)).toEqual({ outcome: "saved" });
    expect(choose).toHaveBeenCalledWith("Deck.pdf");
    expect(choose.mock.invocationCallOrder[0]!).toBeLessThan(writeFile.mock.invocationCallOrder[0]!);
    expect(output).toHaveBeenCalledTimes(1);
    const [path, bytes] = output.mock.calls[0]!;
    expect(path).toBe(SAVE_PATH);
    expect(Buffer.isBuffer(bytes)).toBe(false);
    expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
    expect(Buffer.from(bytes).toString()).toBe("%PDF-1.7 saved");
    expect(writeFile).toHaveBeenCalledWith(request.html, "Deck.html");
    expect(window.loadFile).toHaveBeenCalledWith("C:\\tmp\\uniwork-print\\job-1\\Deck.html");
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("answers cancelled without creating a window or a temp file when the save dialog is dismissed", async () => {
    const { handler, createWindow, writeFile, output } = harness({ chooseSavePath: async () => undefined });
    expect(await handler(request)).toEqual({ outcome: "cancelled" });
    expect(createWindow).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });
  it("lays out in the document's orientation and paper in inches, letting CSS page sizes win, with no page filter by default", async () => {
    const { handler, window } = harness();
    await handler(request);
    const passed = window.webContents.printToPDF.mock.calls[0]![0] as Record<string, unknown>;
    expect(passed).toEqual({ printBackground: true, landscape: true, preferCSSPageSize: true, pageSize: { width: 190_500 / 25_400, height: 338_658 / 25_400 } });
    expect(passed).not.toHaveProperty("pageRanges");
    const portrait = harness();
    await portrait.handler({ ...request, options: { landscape: false, pageSize: { width: 210_000, height: 297_000 } } });
    expect(portrait.window.webContents.printToPDF.mock.calls[0]![0]).toMatchObject({ landscape: false, pageSize: { width: 210_000 / 25_400, height: 297_000 / 25_400 } });
  });
  it("passes the chosen pages as Electron's 1-based range string", async () => {
    const { handler, window } = harness();
    await handler({ ...request, options: { ...options, pageRanges: [{ from: 0, to: 2 }, { from: 4, to: 4 }] } });
    expect(window.webContents.printToPDF.mock.calls[0]![0]).toMatchObject({ pageRanges: "1-3, 5" });
  });
  it("uses the hidden print window: script-free, in-memory partition, no preload, navigation denied", async () => {
    const { handler, createWindow, listeners, openHandler } = harness();
    await handler(request);
    const created = createWindow.mock.calls[0]![0];
    expect(created).toEqual({ show: false, skipTaskbar: true, title: "Deck.pptx", webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
    expect(created.webPreferences).toMatchObject({ javascript: false, sandbox: true, nodeIntegration: false, partition: PRINT_PARTITION });
    expect(created.webPreferences).not.toHaveProperty("preload");
    expect(openHandler()?.()).toEqual({ action: "deny" });
    for (const event of ["will-navigate", "will-redirect", "will-frame-navigate", "will-attach-webview"]) {
      const preventDefault = vi.fn();
      listeners.get(event)!({ preventDefault });
      expect(preventDefault).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses a second save while one runs - the open save dialog counts - then accepts again", async () => {
    let pick: ((path: string | undefined) => void) | undefined;
    const { handler, createWindow } = harness({ chooseSavePath: () => new Promise<string | undefined>((resolve) => { pick = resolve; }) });
    const first = handler(request);
    await vi.waitFor(() => expect(pick).toBeDefined());
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_busy" });
    pick!(SAVE_PATH);
    expect(await first).toEqual({ outcome: "saved" });
    expect(createWindow).toHaveBeenCalledTimes(1);
    pick = undefined;
    const again = handler(request);
    await vi.waitFor(() => expect(pick).toBeDefined());
    pick!(undefined);
    expect(await again).toEqual({ outcome: "cancelled" });
  });
  it("answers print_timeout when printToPDF does not finish, writes nothing, cleans up and frees the slot", async () => {
    const { handler, window, cleanup, output } = harness({ toPdf: () => new Promise<Uint8Array>(() => undefined), timeoutMs: 20 });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_timeout" });
    expect(output).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_timeout" });
  });
  it("answers print_timeout when the load never settles, writes nothing, cleans up and frees the slot", async () => {
    const { handler, window, cleanup, output } = harness({ load: () => new Promise<void>(() => undefined), timeoutMs: 20 });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_timeout" });
    expect(window.webContents.printToPDF).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_timeout" });
  });
  it("answers print_range_invalid when printToPDF rejects a requested page range, and keeps print_unavailable without one", async () => {
    const rejecting = async () => { throw new Error("Invalid pageRanges: 9-12"); };
    const ranged = harness({ toPdf: rejecting });
    expect(await ranged.handler({ ...request, options: { ...options, pageRanges: [{ from: 8, to: 11 }] } })).toEqual({ outcome: "failed", reason: "print_range_invalid" });
    expect(ranged.output).not.toHaveBeenCalled();
    expect(ranged.window.close).toHaveBeenCalledTimes(1);
    expect(ranged.cleanup).toHaveBeenCalledTimes(1);
    const whole = harness({ toPdf: rejecting });
    expect(await whole.handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
  });
  it("defaults to a 60 second timeout", async () => {
    vi.useFakeTimers();
    try {
      const { handler, window } = harness({ toPdf: () => new Promise<Uint8Array>(() => undefined) });
      const answer = handler(request);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(window.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await answer).toEqual({ outcome: "failed", reason: "print_timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("turns a printToPDF failure, sync or async, into print_unavailable and still cleans up", async () => {
    for (const toPdf of [async () => { throw new Error("Failed to generate PDF"); }, () => { throw new Error("destroyed"); }]) {
      const { handler, window, cleanup, output } = harness({ toPdf });
      expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
      expect(output).not.toHaveBeenCalled();
      expect(window.close).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
    }
  });
  it("turns a load failure into print_unavailable and never lays out", async () => {
    const { handler, window, cleanup } = harness({ load: async () => { throw new Error("ERR_FILE_NOT_FOUND"); } });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(window.webContents.printToPDF).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("answers print_unavailable when the temp file or the window cannot be made, and removes the file", async () => {
    const createWindow = vi.fn();
    const noFile = createPrintSavePdfIpcHandler({ createWindow, writeFile: async () => { throw new Error("ENOSPC"); }, chooseSavePath: async () => SAVE_PATH, writeOutput: async () => undefined })["desktop:print-save-pdf"];
    expect(await noFile(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(createWindow).not.toHaveBeenCalled();
    const cleanup = vi.fn(async () => undefined);
    const noWindow = createPrintSavePdfIpcHandler({ createWindow: () => { throw new Error("no display"); }, writeFile: async (_html, fileName) => ({ path: `C:\\tmp\\${fileName}`, cleanup }), chooseSavePath: async () => SAVE_PATH, writeOutput: async () => undefined })["desktop:print-save-pdf"];
    expect(await noWindow(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("answers print_save_failed when the output cannot be written, after cleaning the temp copy", async () => {
    const { handler, window, cleanup, output } = harness({ writeOutput: async () => { throw new Error("EACCES"); } });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_save_failed" });
    expect(output).toHaveBeenCalledTimes(1);
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("answers print_unavailable when the save dialog itself throws, creating no window, and frees the slot", async () => {
    let fail = true;
    const { handler, createWindow } = harness({ chooseSavePath: async () => { if (fail) throw new Error("no window"); return undefined; } });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(createWindow).not.toHaveBeenCalled();
    fail = false;
    expect(await handler(request)).toEqual({ outcome: "cancelled" });
  });
});
