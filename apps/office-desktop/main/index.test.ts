import { describe, expect, it, vi } from "vitest";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./index";

const sender = { senderId: 1, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 1, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const windowPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false } as const;

describe("desktop host bootstrap", () => {
  it("pins secure window preferences and injects the host seams", async () => {
    const loadURL = vi.fn();
    const setUserDataDirectory = vi.fn();
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const host = createDesktopHost({ window: { webContents: contents, webPreferences: windowPreferences, loadURL, setUserDataDirectory }, sender });
    expect(WINDOW_WEB_PREFERENCES).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    await host.start();
    expect(loadURL).toHaveBeenCalledWith("uniwork-office-app://app/index.html");
    expect(setUserDataDirectory).toHaveBeenCalledWith("uniwork-office-dev");
    expect(host.identity.appId).toBe("com.uniwork.office");
  });
  it("rejects a native window seam that changes the secure preferences", () => {
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    expect(() => createDesktopHost({ window: { webContents: contents, webPreferences: { ...windowPreferences, sandbox: false } as unknown as typeof windowPreferences, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender })).toThrow(/sandbox/);
  });
  it("dispatches a validated operation to the supplied slot", async () => {
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const operation = vi.fn().mockResolvedValue({ ok: true });
    const host = createDesktopHost({ window: { webContents: contents, webPreferences: windowPreferences, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender, handlers: { "desktop:engine-call": operation } });
    await expect(host.dispatch("desktop:engine-call", { sessionGeneration: "session_1234", operation: "cancel", handle: "handle:1", args: {} })).resolves.toEqual({ ok: true });
    expect(operation).toHaveBeenCalledOnce();
  });
  it("mediates approved external URLs through the system-browser seam", async () => {
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const openSystemBrowser = vi.fn();
    const host = createDesktopHost({ window: { webContents: contents, webPreferences: windowPreferences, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender, allowedExternalHosts: ["docs.uniwork.com"], openSystemBrowser });
    await expect(host.dispatch("desktop:open-external", { sessionGeneration: "session_1234", url: "https://docs.uniwork.com/help" })).resolves.toEqual({ opened: true });
    expect(openSystemBrowser).toHaveBeenCalledWith("https://docs.uniwork.com/help");
    await expect(host.dispatch("desktop:open-external", { sessionGeneration: "session_1234", url: "https://evil.example/" })).rejects.toMatchObject({ code: "external_url" });
  });
  it("wires the shared desktop engine through the injected IPC port", () => {
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const ipc = { call: vi.fn(), send: vi.fn(), subscribe: vi.fn(() => () => undefined) };
    const host = createDesktopHost({ window: { webContents: contents, webPreferences: windowPreferences, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender, engineIpc: ipc });
    expect(host.adapters?.transport.supports?.("open")).toBe(true);
  });
  it("revokes local handles when the native window closes", () => {
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const revokeSession = vi.fn();
    const on = vi.fn();
    createDesktopHost({ window: { webContents: contents, webPreferences: windowPreferences, loadURL: vi.fn(), setUserDataDirectory: vi.fn(), on }, sender, localFiles: { registry: { revokeSession } } as never });
    const closed = on.mock.calls.find(([event]) => event === "closed")?.[1] as (() => void) | undefined;
    expect(closed).toBeTypeOf("function"); closed?.();
    expect(revokeSession).toHaveBeenCalledOnce();
  });
});
