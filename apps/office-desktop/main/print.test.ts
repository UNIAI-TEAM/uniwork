import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIpcDispatcher, IpcValidationError, IPC_MAX_BYTES, PRINT_HTML_MAX_BYTES, validateIpcRequest } from "./ipc";
import { clearPrintRoot, createPrintFileWriter, createPrintIpcHandler, electronPrintOptions, installPrintSessionGuard, PRINT_CALLBACK_TIMEOUT_MS, PRINT_PARTITION, PRINT_WINDOW_WEB_PREFERENCES, printFileName, printJobTitle, printOutcome, type PrintOwner, type PrintWindow, type PrintWindowOptions } from "./print";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const request = { sessionGeneration: "session_1234", title: "Doc.md", html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'"></head><body><p>x</p></body></html>` };

type PrintCallback = (success: boolean, reason: string) => void;

function fakeWindow(answer: (callback: PrintCallback) => void, load: () => Promise<void>) {
  const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  let openHandler: (() => { action: "deny" }) | undefined;
  let destroyed = false;
  const window = {
    webContents: {
      setWindowOpenHandler: vi.fn((handler: () => { action: "deny" }) => { openHandler = handler; }),
      on: vi.fn((event: string, listener: (event: { preventDefault(): void }) => void) => { listeners.set(event, listener); }),
      print: vi.fn((_options: object, callback: PrintCallback) => answer(callback)),
    },
    loadFile: vi.fn(load),
    isDestroyed: () => destroyed,
    close: vi.fn(() => { destroyed = true; }),
  } satisfies PrintWindow;
  return { window, listeners, openHandler: () => openHandler };
}

function harness(answer: (callback: PrintCallback) => void, load: () => Promise<void> = async () => undefined, owner?: PrintOwner) {
  const fake = fakeWindow(answer, load);
  const cleanup = vi.fn(async () => undefined);
  const writeFile = vi.fn(async (_html: string, fileName: string) => ({ path: `C:\\tmp\\uniwork-print\\job-1\\${fileName}`, cleanup }));
  const createWindow = vi.fn((_options: PrintWindowOptions) => fake.window);
  const handler = createPrintIpcHandler({ createWindow, writeFile, ...(owner ? { owner: () => owner } : {}) })["desktop:print-document"];
  return { ...fake, cleanup, writeFile, createWindow, handler };
}

describe("desktop:print-document validation", () => {
  it("accepts a sanitized copy from the bound app window", () => expect(validateIpcRequest("desktop:print-document", request, context)).toEqual(request));
  it.each([
    ["another webContents", { ...context, senderId: 8 }, "sender"],
    ["a subframe", { ...context, frameId: 3 }, "frame"],
    ["a foreign origin", { ...context, origin: "https://evil.test" }, "origin"],
  ] as const)("refuses %s", (_label, sender, code) => {
    expect(() => validateIpcRequest("desktop:print-document", request, sender)).toThrowError(expect.objectContaining({ code }));
  });
  it.each([
    ["a non-string html", { ...request, html: 42 }],
    ["an empty copy", { ...request, html: "" }],
    ["a path smuggled beside it", { ...request, path: "C:\\secret.html" }],
    ["an over-long title", { ...request, title: "t".repeat(256) }],
    ["a stale session", { ...request, sessionGeneration: "session_9999" }],
  ])("refuses %s", (_label, payload) => {
    expect(() => validateIpcRequest("desktop:print-document", payload, context)).toThrowError(IpcValidationError);
  });
  it("allows a copy above the control budget but refuses one over the print cap", () => {
    expect(() => validateIpcRequest("desktop:print-document", { ...request, html: "x".repeat(IPC_MAX_BYTES * 4) }, context)).not.toThrow();
    expect(() => validateIpcRequest("desktop:print-document", { ...request, html: "x".repeat(PRINT_HTML_MAX_BYTES + 1) }, context)).toThrowError(IpcValidationError);
    expect(() => validateIpcRequest("desktop:print-document", { ...request, html: "x".repeat(PRINT_HTML_MAX_BYTES + IPC_MAX_BYTES) }, context)).toThrowError(expect.objectContaining({ code: "oversize" }));
  });
  it("fails closed when a handler answers outside the response schema", async () => {
    const dispatch = createIpcDispatcher({ "desktop:print-document": async () => ({ outcome: "printed", path: "C:\\x" }) }, context);
    await expect(dispatch("desktop:print-document", request)).rejects.toThrowError(IpcValidationError);
  });
});

// A 13.333 x 7.5 in slide deck, sent as a portrait sheet turned landscape.
const slideOptions = { landscape: true, pageSize: { width: 190_500, height: 338_658 } };

describe("desktop:print-document page options", () => {
  it("accepts the document's orientation and paper", () => {
    const withOptions = { ...request, options: slideOptions };
    expect(validateIpcRequest("desktop:print-document", withOptions, context)).toEqual(withOptions);
  });
  it.each([
    ["a missing landscape flag", { pageSize: slideOptions.pageSize }],
    ["a named size", { landscape: false, pageSize: "A4" }],
    ["a fractional micron", { landscape: false, pageSize: { width: 210_000.5, height: 297_000 } }],
    ["a sheet under 10 mm", { landscape: false, pageSize: { width: 9_999, height: 297_000 } }],
    ["a sheet over 2 m", { landscape: false, pageSize: { width: 210_000, height: 2_000_001 } }],
    ["a negative side", { landscape: false, pageSize: { width: -210_000, height: 297_000 } }],
    ["an extra size key", { landscape: false, pageSize: { width: 210_000, height: 297_000, unit: "mm" } }],
    ["a silent print", { ...slideOptions, silent: true }],
    ["a printer name", { ...slideOptions, deviceName: "Office printer" }],
    ["a string flag", { landscape: "true", pageSize: slideOptions.pageSize }],
  ])("refuses %s", (_label, options) => {
    expect(() => validateIpcRequest("desktop:print-document", { ...request, options }, context)).toThrowError(expect.objectContaining({ code: "schema" }));
  });
  it("opens the dialog in the document's orientation and paper, never silently", () => {
    expect(electronPrintOptions(slideOptions)).toEqual({ silent: false, printBackground: true, landscape: true, pageSize: { width: 190_500, height: 338_658 } });
    expect(electronPrintOptions({ landscape: false, pageSize: { width: 210_000, height: 297_000 } })).toEqual({ silent: false, printBackground: true, landscape: false, pageSize: { width: 210_000, height: 297_000 } });
    expect(electronPrintOptions(undefined)).toEqual({ silent: false, printBackground: true });
  });
  it("hands the validated options to webContents.print", async () => {
    const { handler, window } = harness((callback) => callback(true, ""));
    expect(await handler({ ...request, options: slideOptions })).toEqual({ outcome: "printed" });
    expect(window.webContents.print).toHaveBeenCalledWith({ silent: false, printBackground: true, landscape: true, pageSize: { width: 190_500, height: 338_658 } }, expect.any(Function));
  });
});

describe("main print window", () => {
  it("prints from a hidden, script-free, preload-free window and never the app window", async () => {
    const { handler, createWindow, window, writeFile, cleanup } = harness((callback) => callback(true, ""));
    expect(await handler(request)).toEqual({ outcome: "printed" });
    const options = createWindow.mock.calls[0]![0];
    expect(options).toEqual({ show: false, skipTaskbar: true, title: "Doc.md", webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
    expect(options.webPreferences).toMatchObject({ javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, partition: PRINT_PARTITION });
    expect(options.webPreferences).not.toHaveProperty("preload");
    expect(PRINT_PARTITION.startsWith("persist:")).toBe(false);
    expect(writeFile).toHaveBeenCalledWith(request.html, "Doc.html");
    expect(window.loadFile).toHaveBeenCalledWith("C:\\tmp\\uniwork-print\\job-1\\Doc.html");
    expect(window.webContents.print).toHaveBeenCalledWith({ silent: false, printBackground: true }, expect.any(Function));
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("never lets a blank document title reach the window, so the job is not named after the app", async () => {
    for (const blank of ["", "   ", "\n\t"]) {
      const { handler, createWindow } = harness((callback) => callback(true, ""));
      expect(await handler({ ...request, title: blank })).toEqual({ outcome: "printed" });
      expect(createWindow.mock.calls[0]![0]).toMatchObject({ title: "document", skipTaskbar: true });
    }
  });
  it("denies navigation, redirects, webviews and new windows", async () => {
    const { handler, listeners, openHandler } = harness((callback) => callback(true, ""));
    await handler(request);
    expect(openHandler()?.()).toEqual({ action: "deny" });
    for (const event of ["will-navigate", "will-redirect", "will-frame-navigate", "will-attach-webview"]) {
      const preventDefault = vi.fn();
      listeners.get(event)!({ preventDefault });
      expect(preventDefault).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    [false, "cancelled", { outcome: "cancelled" }],
    [false, "Print job canceled", { outcome: "cancelled" }],
    [false, "failed", { outcome: "failed", reason: "print_failed" }],
    [false, "Invalid deviceName provided", { outcome: "failed", reason: "print_invalid_devicename_provided" }],
    [false, "", { outcome: "failed", reason: "print_failed" }],
    [false, "No preview available", { outcome: "failed", reason: "print_no_preview_available" }],
  ] as const)("maps print(success=%s, %j) to %j and closes the window", async (success, reason, expected) => {
    const { handler, window, cleanup } = harness((callback) => callback(success, reason));
    expect(await handler(request)).toEqual(expected);
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("turns a load failure into a typed failure and still cleans up", async () => {
    const { handler, window, cleanup } = harness(() => undefined, async () => { throw new Error("ERR_FILE_NOT_FOUND"); });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(window.webContents.print).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("refuses a second print while one is open, then accepts again", async () => {
    let finish: PrintCallback | undefined;
    const { handler } = harness((callback) => { finish = callback; });
    const first = handler(request);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_busy" });
    finish!(false, "cancelled");
    expect(await first).toEqual({ outcome: "cancelled" });
    finish = undefined;
    const again = handler(request);
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish!(true, "");
    expect(await again).toEqual({ outcome: "printed" });
  });
});

describe("stuck-busy guard", () => {
  type OwnerEvent = "focus" | "blur";
  function fakeOwner() {
    const byEvent: Record<OwnerEvent, Set<() => void>> = { focus: new Set(), blur: new Set() };
    const owner = {
      on: vi.fn((event: OwnerEvent, listener: () => void) => { byEvent[event].add(listener); }),
      removeListener: vi.fn((event: OwnerEvent, listener: () => void) => { byEvent[event].delete(listener); }),
    } satisfies PrintOwner;
    const emit = (event: OwnerEvent) => [...byEvent[event]].forEach((listener) => listener());
    return { owner, count: () => byEvent.focus.size + byEvent.blur.size, blur: () => emit("blur"), focus: () => emit("focus"), blurThenFocus: () => { emit("blur"); emit("focus"); } };
  }
  it("stays busy while the owner has not regained focus, however long Electron takes", async () => {
    const { owner } = fakeOwner();
    const { handler, window } = harness(() => undefined, undefined, owner);
    void handler(request);
    await vi.waitFor(() => expect(window.webContents.print).toHaveBeenCalledTimes(1));
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_busy" });
    expect(window.close).not.toHaveBeenCalled();
  });
  it("stays busy when the owner is focused without having lost focus first (a late focus as the dialog appears)", async () => {
    const { owner, focus } = fakeOwner();
    const { handler, window } = harness(() => undefined, undefined, owner);
    void handler(request);
    await vi.waitFor(() => expect(window.webContents.print).toHaveBeenCalledTimes(1));
    focus();
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_busy" });
  });
  it("accepts a new print once the owner regained focus although Electron never called back, without closing the open dialog", async () => {
    const { owner, blurThenFocus } = fakeOwner();
    const first = fakeWindow(() => undefined, async () => undefined);
    const second = fakeWindow((callback) => callback(true, ""), async () => undefined);
    const windows = [first.window, second.window];
    const cleanup = vi.fn(async () => undefined);
    const writeFile = vi.fn(async (_html: string, fileName: string) => ({ path: `C:\\tmp\\uniwork-print\\job-1\\${fileName}`, cleanup }));
    const handler = createPrintIpcHandler({ owner: () => owner, writeFile, createWindow: () => windows.shift()! })["desktop:print-document"];
    void handler(request);
    await vi.waitFor(() => expect(first.window.webContents.print).toHaveBeenCalledTimes(1));
    blurThenFocus();
    expect(await handler(request)).toEqual({ outcome: "printed" });
    expect(first.window.close).not.toHaveBeenCalled();
    expect(second.window.close).toHaveBeenCalledTimes(1);
  });
  it("does not let a superseded job's late callback free its successor", async () => {
    const { owner, blurThenFocus } = fakeOwner();
    const callbacks: PrintCallback[] = [];
    const { handler } = harness((callback) => { callbacks.push(callback); }, undefined, owner);
    const first = handler(request);
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    blurThenFocus();
    const second = handler(request);
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    callbacks[0]!(false, "cancelled");
    expect(await first).toEqual({ outcome: "cancelled" });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_busy" });
    callbacks[1]!(true, "");
    expect(await second).toEqual({ outcome: "printed" });
  });
  it("ignores the owner focus a superseded job causes by closing its own window", async () => {
    const { owner, blur, focus, blurThenFocus } = fakeOwner();
    const first = fakeWindow(() => undefined, async () => undefined);
    const callbacks: PrintCallback[] = [];
    const second = fakeWindow((callback) => { callbacks.push(callback); }, async () => undefined);
    const windows = [first.window, second.window];
    const cleanup = vi.fn(async () => undefined);
    const writeFile = vi.fn(async (_html: string, fileName: string) => ({ path: `C:\\tmp\\${fileName}`, cleanup }));
    const handler = createPrintIpcHandler({ owner: () => owner, writeFile, createWindow: () => windows.shift()! })["desktop:print-document"];
    const firstResult = handler(request);
    await vi.waitFor(() => expect(first.window.webContents.print).toHaveBeenCalledTimes(1));
    blurThenFocus();
    const secondResult = handler(request);
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    blur(); // the second dialog took focus from the app window
    // The first dialog finally reports back; closing its window returns focus to the app window.
    first.window.close.mockImplementation(() => focus());
    const lateCallback = first.window.webContents.print.mock.calls[0]![1];
    lateCallback(false, "cancelled");
    expect(await firstResult).toEqual({ outcome: "cancelled" });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_busy" });
    callbacks[0]!(true, "");
    expect(await secondResult).toEqual({ outcome: "printed" });
  });
  it("detaches every owner listener when the job settles", async () => {
    const { owner, count } = fakeOwner();
    const { handler } = harness((callback) => callback(true, ""), undefined, owner);
    await handler(request);
    expect(count()).toBe(0);
  });
  it("detaches a superseded job's listeners at once, before its callback arrives", async () => {
    const { owner, count, blurThenFocus } = fakeOwner();
    const { handler, window } = harness(() => undefined, undefined, owner);
    void handler(request);
    await vi.waitFor(() => expect(window.webContents.print).toHaveBeenCalledTimes(1));
    expect(count()).toBe(2);
    blurThenFocus();
    expect(count()).toBe(0);
  });
});

describe("print owner and callback timeout", () => {
  function owner() {
    return { on: vi.fn(), removeListener: vi.fn() } satisfies PrintOwner;
  }
  it("guards with the owner resolved for this request, not one captured earlier, and never hands it to the print window", async () => {
    const owners = [owner(), owner()];
    const [first, second] = owners;
    const resolve = vi.fn(() => owners.shift());
    const fake = fakeWindow((callback) => callback(true, ""), async () => undefined);
    // Rest args so a stray second argument (the old owner) would show up in the calls.
    const createWindow = vi.fn((..._args: unknown[]) => fake.window);
    const handler = createPrintIpcHandler({ owner: resolve, createWindow, writeFile: async (_html, name) => ({ path: name, cleanup: async () => undefined }) })["desktop:print-document"];
    await handler(request);
    expect(first!.on).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(second!.on).not.toHaveBeenCalled();
    await handler(request);
    expect(second!.on).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(resolve).toHaveBeenCalledTimes(2);
    // Windows cancels a job whose print window is owned by the app window.
    for (const call of createWindow.mock.calls) {
      expect(call).toHaveLength(1);
      expect(call[0]).not.toHaveProperty("parent");
    }
  });
  it("prints when the sending window is gone", async () => {
    const fake = fakeWindow((callback) => callback(true, ""), async () => undefined);
    const createWindow = vi.fn((_options: PrintWindowOptions) => fake.window);
    const handler = createPrintIpcHandler({ owner: () => undefined, createWindow, writeFile: async (_html, name) => ({ path: name, cleanup: async () => undefined }) })["desktop:print-document"];
    expect(await handler(request)).toEqual({ outcome: "printed" });
    expect(createWindow).toHaveBeenCalledTimes(1);
  });
  it("fails closed with a typed reason when resolving the owner throws, and stays usable", async () => {
    const fake = fakeWindow((callback) => callback(true, ""), async () => undefined);
    const createWindow = vi.fn((_options: PrintWindowOptions) => fake.window);
    const writeFile = vi.fn(async (_html: string, name: string) => ({ path: name, cleanup: async () => undefined }));
    let destroyed = true;
    const resolve = vi.fn((): PrintOwner | undefined => {
      if (destroyed) throw new Error("Object has been destroyed");
      return undefined;
    });
    const handler = createPrintIpcHandler({ owner: resolve, createWindow, writeFile })["desktop:print-document"];
    await expect(handler(request)).resolves.toEqual({ outcome: "failed", reason: "print_owner_unavailable" });
    expect(createWindow).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    // The failed attempt freed busy: the next print is accepted.
    destroyed = false;
    await expect(handler(request)).resolves.toEqual({ outcome: "printed" });
  });
  it("answers print_timeout when Electron never calls back, without closing the dialog or freeing busy", async () => {
    vi.useFakeTimers();
    try {
      let finish: PrintCallback | undefined;
      const { handler, window, cleanup } = harness((callback) => { finish = callback; });
      const first = handler(request);
      await vi.waitFor(() => expect(finish).toBeDefined());
      await vi.advanceTimersByTimeAsync(PRINT_CALLBACK_TIMEOUT_MS);
      expect(await first).toEqual({ outcome: "failed", reason: "print_timeout" });
      expect(window.close).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_busy" });
      // The late callback releases the job; the next print is accepted.
      finish!(true, "");
      await vi.waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
      expect(cleanup).toHaveBeenCalledTimes(1);
      finish = undefined;
      const again = handler(request);
      await vi.waitFor(() => expect(finish).toBeDefined());
      finish!(false, "cancelled");
      expect(await again).toEqual({ outcome: "cancelled" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("uses a bounded default wait", () => {
    expect(PRINT_CALLBACK_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(PRINT_CALLBACK_TIMEOUT_MS).toBeLessThanOrEqual(600_000);
  });
  it("turns a print() that throws into a typed failure and releases the job", async () => {
    const { handler, window, cleanup } = harness(() => { throw new Error("boom"); });
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
  });
});

describe("print helpers", () => {
  it("only reports printed for a successful callback", () => {
    expect(printOutcome(true, "cancelled")).toEqual({ outcome: "printed" });
    expect(printOutcome(false, undefined)).toEqual({ outcome: "failed", reason: "print_failed" });
  });
  it("derives a safe job file name from the title", () => {
    expect(printFileName("Báo cáo quý.md")).toBe("Báo cáo quý.html");
    expect(printFileName("..\\..\\evil<>:|?*.html")).toBe("evil.html");
    expect(printFileName("")).toBe("document.html");
    expect(printFileName("Báo cáo.docx")).toBe("Báo cáo.html");
    expect(printFileName("Sheet.XLSX")).toBe("Sheet.html");
  });
  it("falls back to the file-name stem when a title is blank and collapses whitespace", () => {
    expect(printJobTitle("")).toBe("document");
    expect(printJobTitle("  \n ")).toBe("document");
    expect(printJobTitle("  Báo   cáo\n quý.docx ")).toBe("Báo cáo quý.docx");
    expect(printFileName(printJobTitle(""))).toBe("document.html");
  });
  it("limits the print partition to the print root and inline data", () => {
    let filter: ((details: { url: string }, callback: (response: { cancel: boolean }) => void) => void) | undefined;
    installPrintSessionGuard({ webRequest: { onBeforeRequest: (next) => { filter = next; } } }, "file:///C:/tmp/uniwork-print");
    const verdict = (url: string) => { let cancel: boolean | undefined; filter!({ url }, (response) => { cancel = response.cancel; }); return cancel; };
    expect(verdict("file:///C:/tmp/uniwork-print/job-1/Doc.html")).toBe(false);
    expect(verdict("data:image/png;base64,AAAA")).toBe(false);
    expect(verdict("file:///C:/tmp/uniwork-print-other/x.html")).toBe(true);
    expect(verdict("file:///C:/Users/me/secret.txt")).toBe(true);
    expect(verdict("https://evil.test/x.png")).toBe(true);
    expect(verdict("uniwork-office-app://app/index.html")).toBe(true);
  });
});

describe("print job files", () => {
  it("writes each job to its own directory and removes it on cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "uniwork-print-test-"));
    const write = createPrintFileWriter(root);
    const first = await write("<p>a</p>", "Doc.html");
    const second = await write("<p>b</p>", "Doc.html");
    expect(first.path).not.toBe(second.path);
    expect(await readFile(first.path, "utf8")).toBe("<p>a</p>");
    await first.cleanup();
    expect(existsSync(first.path)).toBe(false);
    expect(await readdir(root)).toHaveLength(1);
    await clearPrintRoot(root);
    expect(existsSync(root)).toBe(false);
  });
  it("removes the job directory when the write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "uniwork-print-test-"));
    await expect(createPrintFileWriter(root)("<p>a</p>", join("missing", "Doc.html"))).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    await writeFile(join(root, "stale.html"), "x");
    await clearPrintRoot(root);
    await clearPrintRoot(root);
    expect(existsSync(root)).toBe(false);
  });
});
