import { describe, expect, it, vi } from "vitest";
import { createIpcDispatcher, IpcValidationError, PRINT_HTML_MAX_BYTES, PRINT_PREVIEW_MAX_BYTES, validateIpcRequest } from "./ipc";
import { PRINT_PARTITION, PRINT_WINDOW_WEB_PREFERENCES, type PrintWindowOptions } from "./print";
import { createPrintersIpcHandler, createPrintPreviewIpcHandler, type PreviewWindow } from "./print-preview";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const options = { landscape: true, pageSize: { width: 190_500, height: 338_658 } };
const request = { sessionGeneration: "session_1234", title: "Deck.pptx", html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'"></head><body><p>x</p></body></html>`, options };

describe("desktop:print-preview validation", () => {
  it("accepts a sanitized copy with the document geometry from the bound app window", () => expect(validateIpcRequest("desktop:print-preview", request, context)).toEqual(request));
  it.each([
    ["another webContents", { ...context, senderId: 8 }, "sender"],
    ["a subframe", { ...context, frameId: 3 }, "frame"],
    ["a foreign origin", { ...context, origin: "https://evil.test" }, "origin"],
  ] as const)("refuses %s", (_label, sender, code) => {
    expect(() => validateIpcRequest("desktop:print-preview", request, sender)).toThrowError(expect.objectContaining({ code }));
  });
  it("refuses a stale session", () => {
    expect(() => validateIpcRequest("desktop:print-preview", { ...request, sessionGeneration: "session_9999" }, context)).toThrowError(IpcValidationError);
  });
  it.each([
    ["a non-string html", { ...request, html: 42 }],
    ["an empty copy", { ...request, html: "" }],
    ["missing options", { sessionGeneration: request.sessionGeneration, title: request.title, html: request.html }],
    ["an extra key", { ...request, path: "C:\\secret.html" }],
    ["a silent job", { ...request, options: { ...options, silent: true, deviceName: "Office printer" } }],
    ["a printer name", { ...request, options: { ...options, deviceName: "Office printer" } }],
    ["a named size", { ...request, options: { landscape: false, pageSize: "A4" } }],
  ])("refuses %s", (_label, payload) => {
    expect(() => validateIpcRequest("desktop:print-preview", payload, context)).toThrowError(IpcValidationError);
  });
  it("allows a copy above the control budget but refuses one over the print cap", () => {
    expect(() => validateIpcRequest("desktop:print-preview", { ...request, html: "x".repeat(PRINT_HTML_MAX_BYTES) }, context)).not.toThrow();
    expect(() => validateIpcRequest("desktop:print-preview", { ...request, html: "x".repeat(PRINT_HTML_MAX_BYTES + 1) }, context)).toThrowError(IpcValidationError);
  });
  it("answers the PDF as bytes through the dispatcher and fails closed on text", async () => {
    const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
    const dispatch = createIpcDispatcher({ "desktop:print-preview": async () => ({ outcome: "ready", pdf }) }, context);
    expect(await dispatch("desktop:print-preview", request)).toEqual({ outcome: "ready", pdf });
    const text = createIpcDispatcher({ "desktop:print-preview": async () => ({ outcome: "ready", pdf: "JVBERg==" } as never) }, context);
    await expect(text("desktop:print-preview", request)).rejects.toThrowError(IpcValidationError);
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

function harness(toPdf: () => Promise<Uint8Array>, load?: () => Promise<void>, timeoutMs?: number) {
  const fake = fakeWindow(toPdf, load);
  const cleanup = vi.fn(async () => undefined);
  const writeFile = vi.fn(async (_html: string, fileName: string) => ({ path: `C:\\tmp\\uniwork-print\\job-1\\${fileName}`, cleanup }));
  const createWindow = vi.fn((_options: PrintWindowOptions) => fake.window);
  const handler = createPrintPreviewIpcHandler({ createWindow, writeFile, ...(timeoutMs === undefined ? {} : { timeoutMs }) })["desktop:print-preview"];
  return { ...fake, cleanup, writeFile, createWindow, handler };
}

describe("desktop:print-preview handler", () => {
  it("answers the PDF as an exact Uint8Array and closes the window and removes the file", async () => {
    // A pooled Buffer view: the answer must not carry the unrelated pool memory.
    const pooled = Buffer.from("%PDF-1.7 preview");
    const { handler, window, cleanup, createWindow, writeFile } = harness(async () => pooled);
    const answer = await handler(request);
    expect(answer.outcome).toBe("ready");
    if (answer.outcome !== "ready") throw new Error("unreachable");
    expect(Object.prototype.toString.call(answer.pdf)).toBe("[object Uint8Array]");
    expect(Buffer.isBuffer(answer.pdf)).toBe(false);
    expect(answer.pdf.buffer.byteLength).toBe(answer.pdf.byteLength);
    expect(Buffer.from(answer.pdf).toString()).toBe("%PDF-1.7 preview");
    expect(writeFile).toHaveBeenCalledWith(request.html, "Deck.html");
    expect(window.loadFile).toHaveBeenCalledWith("C:\\tmp\\uniwork-print\\job-1\\Deck.html");
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("lays the copy out in the document's orientation and paper (inches) and lets CSS page sizes win", async () => {
    const { handler, window } = harness(async () => new Uint8Array(4));
    await handler(request);
    expect(window.webContents.printToPDF).toHaveBeenCalledTimes(1);
    const passed = window.webContents.printToPDF.mock.calls[0]![0] as Record<string, unknown>;
    expect(passed).toEqual({ printBackground: true, landscape: true, preferCSSPageSize: true, pageSize: { width: 190_500 / 25_400, height: 338_658 / 25_400 } });
    expect(passed).not.toHaveProperty("pageRanges");
    const portrait = harness(async () => new Uint8Array(4));
    await portrait.handler({ ...request, options: { landscape: false, pageSize: { width: 210_000, height: 297_000 } } });
    expect(portrait.window.webContents.printToPDF.mock.calls[0]![0]).toMatchObject({ landscape: false, pageSize: { width: 210_000 / 25_400, height: 297_000 / 25_400 } });
  });
  it("uses the hidden print window: script-free, in-memory partition, no preload, navigation denied", async () => {
    const { handler, createWindow, listeners, openHandler } = harness(async () => new Uint8Array(4));
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
  it("names a blank title after the fallback, never the app", async () => {
    const { handler, createWindow } = harness(async () => new Uint8Array(4));
    await handler({ ...request, title: "   " });
    expect(createWindow.mock.calls[0]![0]).toMatchObject({ title: "document" });
  });
  it("refuses a second preview while one is running, then accepts again", async () => {
    let finish: ((pdf: Uint8Array) => void) | undefined;
    const { handler } = harness(() => new Promise<Uint8Array>((resolve) => { finish = resolve; }));
    const first = handler(request);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_busy" });
    finish!(new Uint8Array(4));
    expect((await first).outcome).toBe("ready");
    finish = undefined;
    const again = handler(request);
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish!(new Uint8Array(4));
    expect((await again).outcome).toBe("ready");
  });
  it("answers print_timeout when printToPDF does not finish, closes the window, removes the file and frees the slot", async () => {
    const { handler, window, cleanup } = harness(() => new Promise<Uint8Array>(() => undefined), undefined, 20);
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_timeout" });
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    // The slot is free again: the next preview is not busy.
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_timeout" });
  });
  it("defaults to a 60 second timeout", async () => {
    vi.useFakeTimers();
    try {
      const { handler, window } = harness(() => new Promise<Uint8Array>(() => undefined));
      const answer = handler(request);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(window.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await answer).toEqual({ outcome: "failed", reason: "print_timeout" });
      expect(window.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("answers print_preview_too_large for a PDF over the cap and still cleans up", async () => {
    const { handler, window, cleanup } = harness(async () => new Uint8Array(PRINT_PREVIEW_MAX_BYTES + 1));
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_preview_too_large" });
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    const exact = harness(async () => new Uint8Array(PRINT_PREVIEW_MAX_BYTES));
    expect((await exact.handler(request)).outcome).toBe("ready");
  });
  it("turns a printToPDF failure into print_unavailable and still cleans up", async () => {
    const { handler, window, cleanup } = harness(async () => { throw new Error("Failed to generate PDF"); });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("turns a synchronous printToPDF throw into print_unavailable", async () => {
    const { handler, window } = harness(() => { throw new Error("destroyed"); });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(window.close).toHaveBeenCalledTimes(1);
  });
  it("turns a load failure into print_unavailable and never lays out", async () => {
    const { handler, window, cleanup } = harness(async () => new Uint8Array(4), async () => { throw new Error("ERR_FILE_NOT_FOUND"); });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(window.webContents.printToPDF).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("turns a write failure into print_unavailable before any window exists", async () => {
    const createWindow = vi.fn();
    const handler = createPrintPreviewIpcHandler({ createWindow, writeFile: async () => { throw new Error("ENOSPC"); } })["desktop:print-preview"];
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(createWindow).not.toHaveBeenCalled();
  });
  it("answers print_unavailable when the window cannot be created and removes the file", async () => {
    const cleanup = vi.fn(async () => undefined);
    const handler = createPrintPreviewIpcHandler({ createWindow: () => { throw new Error("no display"); }, writeFile: async (_html, fileName) => ({ path: `C:\\tmp\\${fileName}`, cleanup }) })["desktop:print-preview"];
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("desktop:print-printers", () => {
  const listPrinters = (printers: Array<{ name: string; displayName?: string; isDefault?: boolean }>) => createPrintersIpcHandler({ listPrinters: async () => printers })["desktop:print-printers"];
  const ask = { sessionGeneration: "session_1234" };

  it("accepts only the session on the wire", () => {
    expect(validateIpcRequest("desktop:print-printers", ask, context)).toEqual(ask);
    expect(() => validateIpcRequest("desktop:print-printers", { ...ask, filter: "x" }, context)).toThrowError(IpcValidationError);
  });
  it("maps names only, falls back to the name for the display name and defaults isDefault to false", async () => {
    const answer = await listPrinters([
      { name: "HP_LaserJet", displayName: "HP LaserJet", isDefault: true, ...({ description: "secret", options: { "printer-location": "Room 4" } } as object) },
      { name: "Plain" },
      { name: "Blank display", displayName: "" },
    ])(ask);
    expect(answer).toEqual({ printers: [
      { name: "HP_LaserJet", displayName: "HP LaserJet", isDefault: true, needsSystemDialog: false },
      { name: "Plain", displayName: "Plain", isDefault: false, needsSystemDialog: false },
      { name: "Blank display", displayName: "Blank display", isDefault: false, needsSystemDialog: false },
    ] });
  });
  it("drops entries with an empty or oversized name and truncates a long display name", async () => {
    const answer = await listPrinters([{ name: "" }, { name: "n".repeat(257) }, { name: "ok", displayName: "d".repeat(300) }])(ask);
    expect(answer.printers).toEqual([{ name: "ok", displayName: "d".repeat(256), isDefault: false, needsSystemDialog: false }]);
  });
  it("caps the list at 128 printers", async () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ name: `printer-${index}` }));
    const answer = await listPrinters(many)(ask);
    expect(answer.printers).toHaveLength(128);
    expect(answer.printers[0]!.name).toBe("printer-0");
  });
  it("answers an empty list when the OS call throws", async () => {
    const handler = createPrintersIpcHandler({ listPrinters: async () => { throw new Error("spooler down"); } })["desktop:print-printers"];
    expect(await handler(ask)).toEqual({ printers: [] });
    const sync = createPrintersIpcHandler({ listPrinters: () => { throw new Error("destroyed"); } })["desktop:print-printers"];
    expect(await sync(ask)).toEqual({ printers: [] });
  });
  it("marks the OS default printer when the list does not say which it is", async () => {
    const printers = async () => [{ name: "OneNote" }, { name: "Microsoft Print to PDF" }];
    const handler = createPrintersIpcHandler({ listPrinters: printers, defaultPrinter: async () => "Microsoft Print to PDF" })["desktop:print-printers"];
    expect((await handler(ask)).printers.map((printer) => printer.isDefault)).toEqual([false, true]);
    const failing = createPrintersIpcHandler({ listPrinters: printers, defaultPrinter: () => { throw new Error("reg"); } })["desktop:print-printers"];
    expect((await failing(ask)).printers).toHaveLength(2);
  });
  it("flags a printer whose port prompts, leaves unknown and silent ports unflagged, and keeps the default mark", async () => {
    const printers = async () => [{ name: "Microsoft Print to PDF" }, { name: "Fax" }, { name: "OneNote (Desktop)" }, { name: "Unlisted" }, { name: "Microsoft XPS Document Writer" }];
    const ports = async () => new Map([["Microsoft Print to PDF", "PORTPROMPT:"], ["Fax", "SHRFAX:"], ["OneNote (Desktop)", "nul:"], ["Microsoft XPS Document Writer", "XPSPort:"]]);
    const handler = createPrintersIpcHandler({ listPrinters: printers, printerPorts: ports, defaultPrinter: async () => "Microsoft Print to PDF" })["desktop:print-printers"];
    expect((await handler(ask)).printers.map((printer) => [printer.name, printer.needsSystemDialog, printer.isDefault])).toEqual([
      ["Microsoft Print to PDF", true, true],
      ["Fax", true, false],
      ["OneNote (Desktop)", false, false],
      ["Unlisted", false, false],
      ["Microsoft XPS Document Writer", true, false],
    ]);
  });
  it("flags nothing without a port reader, and never loses the list when the reader fails or answers rubbish", async () => {
    const printers = async () => [{ name: "A" }, { name: "B" }];
    const none = createPrintersIpcHandler({ listPrinters: printers })["desktop:print-printers"];
    expect((await none(ask)).printers.map((printer) => printer.needsSystemDialog)).toEqual([false, false]);
    for (const printerPorts of [async () => { throw new Error("reg"); }, () => { throw new Error("sync"); }, async () => "garbage" as never, async () => undefined as never]) {
      const handler = createPrintersIpcHandler({ listPrinters: printers, printerPorts })["desktop:print-printers"];
      const answer = await handler(ask);
      expect(answer.printers.map((printer) => printer.name)).toEqual(["A", "B"]);
      expect(answer.printers.map((printer) => printer.needsSystemDialog)).toEqual([false, false]);
    }
  });
  it("passes the dispatcher's response check", async () => {
    const dispatch = createIpcDispatcher({ "desktop:print-printers": listPrinters([{ name: "A", isDefault: true }]) }, context);
    expect(await dispatch("desktop:print-printers", ask)).toEqual({ printers: [{ name: "A", displayName: "A", isDefault: true, needsSystemDialog: false }] });
    const missing = createIpcDispatcher({ "desktop:print-printers": async () => ({ printers: [{ name: "A", displayName: "A", isDefault: true }] } as never) }, context);
    await expect(missing("desktop:print-printers", ask)).rejects.toThrowError(IpcValidationError);
  });
});
