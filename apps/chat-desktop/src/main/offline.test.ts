import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installOfflineFallback, OFFLINE_RETRY_MS, type OfflineWindow } from "./offline";

type FailListener = (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void;

type GoneListener = (event: unknown, details: { reason: string }) => void;

function fakeWindow(overrides: Partial<Pick<OfflineWindow, "loadFile" | "loadURL">> = {}) {
  let listener: FailListener | undefined;
  let goneListener: GoneListener | undefined;
  const win = {
    webContents: {
      on: vi.fn((event: string, l: FailListener | GoneListener): void => {
        if (event === "did-fail-load") listener = l as FailListener;
        if (event === "render-process-gone") goneListener = l as GoneListener;
      }),
    },
    isDestroyed: vi.fn(() => false),
    loadFile: vi.fn(() => Promise.resolve()),
    loadURL: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  installOfflineFallback(win, { appUrl: "https://chat.example", offlinePath: "/res/offline.html" });
  const fail = (code = -106, url = "https://chat.example/", mainFrame = true) =>
    listener!({}, code, "ERR", url, mainFrame);
  const gone = (reason: string) => goneListener!({}, { reason });
  return { win, fail, gone };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("installOfflineFallback", () => {
  it("shows the offline page and retries the app after the delay", async () => {
    const { win, fail } = fakeWindow();
    fail();
    expect(win.loadFile).toHaveBeenCalledWith("/res/offline.html", { query: { app: "https://chat.example" } });
    expect(win.loadURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    expect(win.loadURL).toHaveBeenCalledWith("https://chat.example");
  });

  it("ignores subframes, aborted loads and a failing offline page itself", () => {
    const { win, fail } = fakeWindow();
    fail(-106, "https://chat.example/x", false);
    fail(-3);
    fail(-6, "file:///res/offline.html");
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it("keeps a single retry timer across repeated failures", async () => {
    const { win, fail } = fakeWindow();
    fail();
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS - 1000);
    fail();
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    expect(win.loadURL).toHaveBeenCalledTimes(1);
  });

  it("does not retry into a destroyed window", async () => {
    const { win, fail } = fakeWindow();
    fail();
    win.isDestroyed.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it("brings the app back after its renderer crashed or was killed, through the offline page", async () => {
    const { win, gone } = fakeWindow();
    gone("crashed");
    expect(win.loadFile).toHaveBeenCalledWith("/res/offline.html", { query: { app: "https://chat.example" } });
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    expect(win.loadURL).toHaveBeenCalledWith("https://chat.example");
  });

  it("leaves a renderer that exited cleanly (window closing) alone", async () => {
    const { win, gone } = fakeWindow();
    gone("clean-exit");
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    expect(win.loadFile).not.toHaveBeenCalled();
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it("swallows load rejections: did-fail-load is the signal, not the promise", async () => {
    const { fail } = fakeWindow({
      loadFile: vi.fn(() => Promise.reject(new Error("file"))),
      loadURL: vi.fn(() => Promise.reject(new Error("net"))),
    });
    fail();
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    // an unhandled rejection would fail this run
  });
});
