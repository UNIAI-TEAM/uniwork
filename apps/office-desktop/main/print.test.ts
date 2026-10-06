import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIpcDispatcher, IpcValidationError, IPC_MAX_BYTES, PRINT_HTML_MAX_BYTES, validateIpcRequest } from "./ipc";
import { clearPrintRoot, createPrintFileWriter, createPrintIpcHandler, installPrintSessionGuard, PRINT_PARTITION, PRINT_WINDOW_WEB_PREFERENCES, printFileName, printOutcome, type PrintDocumentOptions, type PrintWindow, type PrintWindowOptions } from "./print";

type PrintOwner = NonNullable<PrintDocumentOptions["owner"]>;
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
      print: vi.fn((_options: { silent: boolean; printBackground: boolean }, callback: PrintCallback) => answer(callback)),
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
  const handler = createPrintIpcHandler({ createWindow, writeFile, ...(owner ? { owner } : {}) })["desktop:print-document"];
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

describe("main print window", () => {
  it("prints from a hidden, script-free, preload-free window and never the app window", async () => {
    const { handler, createWindow, window, writeFile, cleanup } = harness((callback) => callback(true, ""));
    expect(await handler(request)).toEqual({ outcome: "printed" });
    const options = createWindow.mock.calls[0]![0];
    expect(options).toEqual({ show: false, title: "Doc.md", webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
    expect(options.webPreferences).toMatchObject({ javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, partition: PRINT_PARTITION });
    expect(options.webPreferences).not.toHaveProperty("preload");
    expect(PRINT_PARTITION.startsWith("persist:")).toBe(false);
    expect(writeFile).toHaveBeenCalledWith(request.html, "Doc.html");
    expect(window.loadFile).toHaveBeenCalledWith("C:\\tmp\\uniwork-print\\job-1\\Doc.html");
    expect(window.webContents.print).toHaveBeenCalledWith({ silent: false, printBackground: true }, expect.any(Function));
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
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
    const handler = createPrintIpcHandler({ owner, writeFile, createWindow: () => windows.shift()! })["desktop:print-document"];
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
    const handler = createPrintIpcHandler({ owner, writeFile, createWindow: () => windows.shift()! })["desktop:print-document"];
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

describe("print helpers", () => {
  it("only reports printed for a successful callback", () => {
    expect(printOutcome(true, "cancelled")).toEqual({ outcome: "printed" });
    expect(printOutcome(false, undefined)).toEqual({ outcome: "failed", reason: "print_failed" });
  });
  it("derives a safe job file name from the title", () => {
    expect(printFileName("Báo cáo quý.md")).toBe("Báo cáo quý.html");
    expect(printFileName("..\\..\\evil<>:|?*.html")).toBe("evil.html");
    expect(printFileName("")).toBe("document.html");
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
