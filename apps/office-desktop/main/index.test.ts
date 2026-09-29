import { describe, expect, it, vi } from "vitest";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./index";

const sender = { senderId: 1, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 1, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };

describe("desktop host bootstrap", () => {
  it("pins secure window preferences and injects the host seams", async () => {
    const loadURL = vi.fn();
    const setUserDataDirectory = vi.fn();
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const host = createDesktopHost({ window: { webContents: contents, loadURL, setUserDataDirectory }, sender });
    expect(WINDOW_WEB_PREFERENCES).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    await host.start();
    expect(loadURL).toHaveBeenCalledWith("uniwork-office-app://app/index.html");
    expect(setUserDataDirectory).toHaveBeenCalledWith("uniwork-office-dev");
    expect(host.identity.appId).toBe("com.uniwork.office");
  });
  it("dispatches a validated operation to the supplied slot", async () => {
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const operation = vi.fn().mockResolvedValue({ ok: true });
    const host = createDesktopHost({ window: { webContents: contents, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender, handlers: { "desktop:engine-call": operation } });
    await expect(host.dispatch("desktop:engine-call", { sessionGeneration: "session_1234", operation: "cancel", handle: "handle:1", args: {} })).resolves.toEqual({ ok: true });
    expect(operation).toHaveBeenCalledOnce();
  });
  it("wires the shared desktop engine through the injected IPC port", () => {
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const ipc = { call: vi.fn(), send: vi.fn(), subscribe: vi.fn(() => () => undefined) };
    const host = createDesktopHost({ window: { webContents: contents, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender, engineIpc: ipc });
    expect(host.adapters?.transport.supports?.("open")).toBe(true);
  });
});
