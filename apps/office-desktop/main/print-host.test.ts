import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createPrintHost, type PrintHostOwner } from "./print-host";
import { PRINT_PARTITION, PRINT_WINDOW_WEB_PREFERENCES, type PrintWindow } from "./print";

const DIST = join(tmpdir(), "uniwork-dist");
const request = { sessionGeneration: "session_1234", title: "Report.docx", html: "<!doctype html><html><head><title>Report</title></head><body><p>x</p></body></html>" };

function owner(destroyed = false) {
  return { on: vi.fn(), removeListener: vi.fn(), isDestroyed: () => destroyed } satisfies PrintHostOwner;
}

function printWindow(): PrintWindow {
  return {
    webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), print: vi.fn((_options, callback) => callback(true, "")) },
    loadFile: vi.fn(async () => undefined),
    isDestroyed: () => false,
    close: vi.fn(),
  };
}

async function setup(sender: () => PrintHostOwner | null | undefined) {
  const temp = await mkdtemp(join(tmpdir(), "uniwork-print-host-"));
  let filter: ((details: { url: string }, callback: (response: { cancel: boolean }) => void) => void) | undefined;
  const partitionSession = vi.fn((_partition: string) => ({ webRequest: { onBeforeRequest: (next: typeof filter) => { filter = next; } } }));
  const createWindow = vi.fn((_options: object) => printWindow());
  return { temp, partitionSession, createWindow, verdict: (url: string) => { let cancel: boolean | undefined; filter!({ url }, (response) => { cancel = response.cancel; }); return cancel; }, sender };
}

describe("print host wiring", () => {
  it("guards the in-memory print partition to its own root and sweeps stale jobs", async () => {
    const h = await setup(() => owner());
    const stale = join(h.temp, "uniwork-print", "job-old");
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "Doc.html"), "x");
    await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, distDirectory: DIST, platform: "win32" });
    expect(h.partitionSession).toHaveBeenCalledWith(PRINT_PARTITION);
    expect(existsSync(stale)).toBe(false);
    expect(h.verdict(`${pathToFileURL(join(h.temp, "uniwork-print")).href}/job-1/Doc.html`)).toBe(false);
    expect(h.verdict("https://evil.test/x.png")).toBe(true);
  });
  it("never parents a print window, not even to the live window that sent the request", async () => {
    const senders = [owner(), owner()];
    let current = senders[0]!;
    const h = await setup(() => current);
    const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
    expect(await handler(request)).toEqual({ outcome: "printed" });
    current = senders[1]!;
    expect(await handler(request)).toEqual({ outcome: "printed" });
    expect(h.createWindow.mock.calls[0]![0]).toEqual({ show: false, skipTaskbar: true, title: "Report.docx", icon: join(DIST, "icons", "icon.ico"), webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
    expect(h.createWindow.mock.calls[1]![0]).not.toHaveProperty("parent");
    // Each request still resolves its own sender, for the busy guard's focus signal.
    expect(senders[0]!.on).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(senders[1]!.on).toHaveBeenCalledWith("focus", expect.any(Function));
  });
  it("titles a print window whose document has no title after the document, never the app, and gives it the platform icon", async () => {
    for (const [platform, icon] of [["win32", "icon.ico"], ["linux", "icon.png"]] as const) {
      const h = await setup(() => owner());
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, distDirectory: DIST, platform }))["desktop:print-document"];
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
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
      expect(await handler(request)).toEqual({ outcome: "printed" });
      expect(h.createWindow.mock.calls[0]![0]).not.toHaveProperty("parent");
    }
  });
  it("fails closed with a typed reason when the sender window cannot be read", async () => {
    for (const broken of [() => { throw new Error("Object has been destroyed"); }, () => ({ on: vi.fn(), removeListener: vi.fn(), isDestroyed: () => { throw new Error("Object has been destroyed"); } })]) {
      const h = await setup(broken);
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow, distDirectory: DIST, platform: "win32" }))["desktop:print-document"];
      expect(await handler(request)).toEqual({ outcome: "failed", reason: "print_owner_unavailable" });
      expect(h.createWindow).not.toHaveBeenCalled();
    }
  });
});
