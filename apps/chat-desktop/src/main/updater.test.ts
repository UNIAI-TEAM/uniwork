import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startUpdater, UPDATE_CHECK_INTERVAL_MS, updateMode, type UpdaterDeps } from "./updater";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  checkForUpdates = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null));
}

function start(mode: UpdaterDeps["mode"]) {
  const updater = new FakeUpdater();
  const deps = { mode, notify: vi.fn<UpdaterDeps["notify"]>(), openDownloadPage: vi.fn() };
  startUpdater({ ...deps, updater: updater as unknown as UpdaterDeps["updater"] });
  return { updater, ...deps };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("updateMode", () => {
  it("only an unsigned mac build is limited to a notice", () => {
    expect(updateMode("darwin", false)).toBe("notify");
    expect(updateMode("darwin", true)).toBe("install");
    expect(updateMode("win32", false)).toBe("install");
    expect(updateMode("linux", false)).toBe("install");
  });
});

describe("startUpdater", () => {
  it("checks at start and then on the interval", () => {
    const { updater } = start("install");
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("install mode downloads by itself and says so once the update is ready", () => {
    const { updater, notify } = start("install");
    expect(updater.autoDownload).toBe(true);
    updater.emit("update-available", { version: "0.1.0-dev.4" });
    expect(notify).not.toHaveBeenCalled();
    updater.emit("update-downloaded", { version: "0.1.0-dev.4" });
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      title: "Đã có bản UniChat mới",
      body: "Bản 0.1.0-dev.4 sẽ được cài khi bạn thoát UniChat.",
    });
  });

  it("notify mode never downloads, tells once per version and opens the download page on click", () => {
    const { updater, notify, openDownloadPage } = start("notify");
    expect(updater.autoDownload).toBe(false);
    expect(updater.listenerCount("update-downloaded")).toBe(0);
    updater.emit("update-available", { version: "0.1.0-dev.4" });
    updater.emit("update-available", { version: "0.1.0-dev.4" });
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      { title: "Đã có bản UniChat mới", body: "Bản 0.1.0-dev.4 đã có. Bấm để mở trang tải về." },
      openDownloadPage,
    );
    updater.emit("update-available", { version: "0.1.0-dev.5" });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("a failed check or download is swallowed (electron-updater logs it), never an unhandled rejection", async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ downloadPromise: Promise.reject(new Error("checksum")) });
    startUpdater({ updater: updater as unknown as UpdaterDeps["updater"], mode: "install", notify: vi.fn(), openDownloadPage: vi.fn() });
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    await vi.runAllTicks();
    await Promise.resolve();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
