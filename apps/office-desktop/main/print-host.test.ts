import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createPrintHost, type PrintHostOwner } from "./print-host";
import { PRINT_PARTITION, PRINT_WINDOW_WEB_PREFERENCES, type PrintWindow } from "./print";

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
    await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow });
    expect(h.partitionSession).toHaveBeenCalledWith(PRINT_PARTITION);
    expect(existsSync(stale)).toBe(false);
    expect(h.verdict(`${pathToFileURL(join(h.temp, "uniwork-print")).href}/job-1/Doc.html`)).toBe(false);
    expect(h.verdict("https://evil.test/x.png")).toBe(true);
  });
  it("parents each print window to the window that sent that request", async () => {
    const senders = [owner(), owner()];
    let current = senders[0]!;
    const h = await setup(() => current);
    const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow }))["desktop:print-document"];
    expect(await handler(request)).toEqual({ outcome: "printed" });
    current = senders[1]!;
    expect(await handler(request)).toEqual({ outcome: "printed" });
    expect(h.createWindow.mock.calls[0]![0]).toEqual({ show: false, title: "Report.docx", webPreferences: PRINT_WINDOW_WEB_PREFERENCES, parent: senders[0] });
    expect(h.createWindow.mock.calls[1]![0]).toMatchObject({ parent: senders[1] });
  });
  it("prints unparented when the sender window is gone or destroyed", async () => {
    for (const gone of [() => null, () => owner(true)]) {
      const h = await setup(gone);
      const handler = (await createPrintHost({ tempDirectory: h.temp, partitionSession: h.partitionSession, senderWindow: h.sender, createWindow: h.createWindow }))["desktop:print-document"];
      expect(await handler(request)).toEqual({ outcome: "printed" });
      expect(h.createWindow.mock.calls[0]![0]).not.toHaveProperty("parent");
    }
  });
});
