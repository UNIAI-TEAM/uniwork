import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createPrintHost, type PrintHostOwner } from "./print-host";
import { PRINT_PARTITION, PRINT_WINDOW_WEB_PREFERENCES } from "./print";
import type { PreviewWindow } from "./print-preview";

const DIST = join(tmpdir(), "uniwork-dist");
const request = { sessionGeneration: "session_1234", title: "Report.docx", html: "<!doctype html><html><head><title>Report</title></head><body><p>x</p></body></html>" };
const previewRequest = { ...request, options: { landscape: false, pageSize: { width: 210_000, height: 297_000 } } };

function owner(destroyed = false) {
  return { on: vi.fn(), removeListener: vi.fn(), isDestroyed: () => destroyed } satisfies PrintHostOwner;
}

function printWindow(): PreviewWindow & { destroy: Mock<() => void>; once: Mock<(event: "closed", listener: () => void) => void>; emitClosed(): void } {
  let destroyed = false;
  const closedListeners: Array<() => void> = [];
  return {
    webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), print: vi.fn((_options, callback) => callback(true, "")), printToPDF: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])) },
    loadFile: vi.fn(async () => undefined),
    isDestroyed: () => destroyed,
    close: vi.fn(),
    destroy: vi.fn<() => void>(() => { destroyed = true; }),
    once: vi.fn((_event: "closed", listener: () => void) => { closedListeners.push(listener); }),
    emitClosed: () => { for (const listener of closedListeners) listener(); },
  };
}

async function setup(sender: () => PrintHostOwner | null | undefined) {
  const temp = await mkdtemp(join(tmpdir(), "uniwork-print-host-"));
  let filter: ((details: { url: string }, callback: (response: { cancel: boolean }) => void) => void) | undefined;
  const partitionSession = vi.fn((_partition: string) => ({ webRequest: { onBeforeRequest: (next: typeof filter) => { filter = next; } } }));
  const createWindow = vi.fn((_options: object) => printWindow());
  const shutdowns: Array<() => void> = [];
  const registerShutdown = vi.fn((closeWindows: () => void) => { shutdowns.push(closeWindows); });
  return { temp, partitionSession, createWindow, registerShutdown, shutdown: () => shutdowns.forEach((close) => close()), verdict: (url: string) => { let cancel: boolean | undefined; filter!({ url }, (response) => { cancel = response.cancel; }); return cancel; }, sender };
}

describe("print host wiring", () => {
  it("guards the in-memory print partition to its own root and sweeps stale jobs", async () => {
    const h = await setup(() => owner());
    const stale = join(h.temp, "uniwork-print", "job-old");
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "Doc.html"), "x");
    await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform: "win32" });
    expect(h.partitionSession).toHaveBeenCalledWith(PRINT_PARTITION);
    expect(existsSync(stale)).toBe(false);
    expect(h.verdict(`${pathToFileURL(join(h.temp, "uniwork-print")).href}/job-1/Doc.html`)).toBe(false);
    expect(h.verdict("https://evil.test/x.png")).toBe(true);
  });
  it("never parents a print window on Windows, not even to the live window that sent the request", async () => {
    const senders = [owner(), owner()];
    let current = senders[0]!;
    const h = await setup(() => current);
    const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
    expect(await handler(request)).toEqual({ outcome: "printed" });
    current = senders[1]!;
    expect(await handler(request)).toEqual({ outcome: "printed" });
    expect(h.createWindow.mock.calls[0]![0]).toEqual({ show: false, skipTaskbar: true, title: "Report.docx", icon: join(DIST, "icons", "icon.ico"), webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
    expect(h.createWindow.mock.calls[1]![0]).not.toHaveProperty("parent");
    // Each request still resolves its own sender, for the busy guard's focus signal.
    expect(senders[0]!.on).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(senders[1]!.on).toHaveBeenCalledWith("focus", expect.any(Function));
  });
  it("keeps parenting the print window to the live sender on macOS and Linux, where the Windows cancel was never shown", async () => {
    for (const platform of ["darwin", "linux"] as const) {
      const sender = owner();
      const h = await setup(() => sender);
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform }))["desktop:print-document"];
      expect(await handler(request)).toEqual({ outcome: "printed" });
      expect(h.createWindow.mock.calls[0]![0]).toMatchObject({ parent: sender, show: false });
      // A gone or destroyed sender prints unparented there too.
      const gone = await setup(() => owner(true));
      const goneHandler = (await createPrintHost({ tempDirectory: gone.temp, partitionSession: gone.partitionSession, senderWindow: gone.sender, createWindow: gone.createWindow, registerShutdown: gone.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform }))["desktop:print-document"];
      expect(await goneHandler(request)).toEqual({ outcome: "printed" });
      expect(gone.createWindow.mock.calls[0]![0]).not.toHaveProperty("parent");
    }
  });
  it("destroys a live print window when the app window closes or the app quits, so the hidden window never keeps the app alive", async () => {
    const h = await setup(() => owner());
    const created: Array<ReturnType<typeof printWindow>> = [];
    h.createWindow.mockImplementation(() => { const next = printWindow(); next.webContents.print = vi.fn(); created.push(next); return next; });
    const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
    expect(h.registerShutdown).toHaveBeenCalledTimes(1);
    void handler(request);
    await vi.waitFor(() => expect(created[0]!.webContents.print).toHaveBeenCalledTimes(1));
    // Nothing touches an open dialog while the app lives.
    expect(created[0]!.destroy).not.toHaveBeenCalled();
    h.shutdown();
    expect(created[0]!.destroy).toHaveBeenCalledTimes(1);
    // Closing then quitting is two calls: the second finds nothing to do.
    h.shutdown();
    expect(created[0]!.destroy).toHaveBeenCalledTimes(1);
  });
  it("does not touch a print window that already finished and was released", async () => {
    const h = await setup(() => owner());
    const created: Array<ReturnType<typeof printWindow>> = [];
    h.createWindow.mockImplementation(() => { const next = printWindow(); next.close = vi.fn(() => { next.destroy(); }); created.push(next); return next; });
    const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
    expect(await handler(request)).toEqual({ outcome: "printed" });
    expect(created[0]!.destroy).toHaveBeenCalledTimes(1); // the release closed it (the fake maps close to destroy)
    h.shutdown();
    expect(created[0]!.destroy).toHaveBeenCalledTimes(1);
  });
  it("forgets a print window once it has closed, so a finished job is not held until the next print", async () => {
    const h = await setup(() => owner());
    const created: Array<ReturnType<typeof printWindow>> = [];
    h.createWindow.mockImplementation(() => { const next = printWindow(); next.webContents.print = vi.fn(); created.push(next); return next; });
    const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
    void handler(request);
    await vi.waitFor(() => expect(created[0]!.webContents.print).toHaveBeenCalledTimes(1));
    expect(created[0]!.once).toHaveBeenCalledWith("closed", expect.any(Function));
    // The window reports closed while nothing else (no second print) ran: shutdown has nothing left to destroy.
    created[0]!.emitClosed();
    h.shutdown();
    expect(created[0]!.destroy).not.toHaveBeenCalled();
  });
  it("uses the unparented focus rule on Windows and the immediate one elsewhere", async () => {
    for (const [platform, ends] of [["win32", true], ["darwin", false]] as const) {
      const sender = { listeners: { focus: new Set<() => void>(), blur: new Set<() => void>() }, isDestroyed: () => false } as const;
      const hostOwner = { on: vi.fn((event: "focus" | "blur", listener: () => void) => { sender.listeners[event].add(listener); }), removeListener: vi.fn(), isDestroyed: () => false } satisfies PrintHostOwner;
      const h = await setup(() => hostOwner);
      const windowsMade: Array<ReturnType<typeof printWindow>> = [];
      h.createWindow.mockImplementation(() => { const next = printWindow(); next.webContents.print = vi.fn(); windowsMade.push(next); return next; });
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform }))["desktop:print-document"];
      void handler(request);
      await vi.waitFor(() => expect(windowsMade[0]!.webContents.print).toHaveBeenCalledTimes(1));
      sender.listeners.blur.forEach((listener) => listener());
      sender.listeners.focus.forEach((listener) => listener());
      // Windows: the dialog may still be open beside the focused app window, so a second Print is busy.
      const second = handler(request);
      if (ends) expect(await second).toEqual({ outcome: "failed", reason: "print_busy" });
      else await vi.waitFor(() => expect(windowsMade).toHaveLength(2));
    }
  });
  it("titles a print window whose document has no title after the document, never the app, and gives it the platform icon", async () => {
    for (const [platform, icon] of [["win32", "icon.ico"], ["linux", "icon.png"]] as const) {
      const h = await setup(() => owner());
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform }))["desktop:print-document"];
      expect(await handler({ ...request, title: "  " })).toEqual({ outcome: "printed" });
      const options = h.createWindow.mock.calls[0]![0] as { title: string; icon: string };
      expect(options.title).toBe("document");
      expect(options.title).not.toMatch(/electron/i);
      expect(options.icon).toBe(join(DIST, "icons", icon));
    }
  });
  it("prints unparented when the sender window is gone or destroyed", async () => {
    for (const gone of [() => null, () => owner(true)]) {
      const h = await setup(gone);
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
      expect(await handler(request)).toEqual({ outcome: "printed" });
      expect(h.createWindow.mock.calls[0]![0]).not.toHaveProperty("parent");
    }
  });
  it("fails closed with a typed reason when the sender window cannot be read", async () => {
    for (const broken of [() => { throw new Error("Object has been destroyed"); }, () => ({ on: vi.fn(), removeListener: vi.fn(), isDestroyed: () => { throw new Error("Object has been destroyed"); } })]) {
      const h = await setup(broken);
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
      expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_owner_unavailable" });
      expect(h.createWindow).not.toHaveBeenCalled();
    }
  });
});

describe("print host preview and printers", () => {
  it("returns the print, preview and printers handlers", async () => {
    const h = await setup(() => owner());
    const handlers = await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [{ name: "HP", displayName: "HP LaserJet", isDefault: true }], distDirectory: DIST, platform: "win32" });
    expect(Object.keys(handlers).sort()).toEqual(["desktop:print-document", "desktop:print-preview", "desktop:print-printers"]);
    expect(await handlers["desktop:print-printers"]({ sessionGeneration: "session_1234" })).toEqual({ printers: [{ name: "HP", displayName: "HP LaserJet", isDefault: true }] });
  });
  it("lays a preview out in a branded, tracked, never-parented window under the same print root", async () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const h = await setup(() => owner());
      const created: Array<ReturnType<typeof printWindow>> = [];
      h.createWindow.mockImplementation(() => { const next = printWindow(); created.push(next); return next; });
      const handlers = await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform });
      const answer = await handlers["desktop:print-preview"](previewRequest);
      expect(answer.outcome).toBe("ready");
      const options = h.createWindow.mock.calls[0]![0] as { title: string; icon: string };
      expect(options).toMatchObject({ show: false, skipTaskbar: true, title: "Report.docx", webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
      expect(options).not.toHaveProperty("parent");
      expect(options.icon).toBe(join(DIST, "icons", platform === "win32" ? "icon.ico" : "icon.png"));
      expect(created[0]!.close).toHaveBeenCalledTimes(1);
      expect(created[0]!.once).toHaveBeenCalledWith("closed", expect.any(Function));
      expect(created[0]!.webContents.printToPDF).toHaveBeenCalledTimes(1);
    }
  });
  it("destroys a preview that is still laying out when the app window closes or the app quits", async () => {
    const h = await setup(() => owner());
    const created: Array<ReturnType<typeof printWindow>> = [];
    h.createWindow.mockImplementation(() => { const next = printWindow(); next.webContents.printToPDF = vi.fn(() => new Promise<Uint8Array>(() => undefined)); created.push(next); return next; });
    const handlers = await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, registerShutdown: h.registerShutdown, listPrinters: async () => [], distDirectory: DIST, platform: "win32" });
    void handlers["desktop:print-preview"](previewRequest);
    await vi.waitFor(() => expect(created[0]!.webContents.printToPDF).toHaveBeenCalledTimes(1));
    h.shutdown();
    expect(created[0]!.destroy).toHaveBeenCalledTimes(1);
  });
});
