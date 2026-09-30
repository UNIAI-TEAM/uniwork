import { describe, expect, it, vi } from "vitest";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./index";
import { FakeExchangePort, createLaunchBridge } from "./deep-links";
import { DESKTOP_IDENTITY } from "../shared/identity";

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
    expect(setUserDataDirectory).toHaveBeenCalledWith(DESKTOP_IDENTITY.userDataNamespace);
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

  it("registers the scheme and emits only the narrow launch event after exchange", async () => {
    const ticket = `ticket_${"c".repeat(32)}`;
    const exchange = new FakeExchangePort();
    exchange.issueTicket({ ticket, accountId: "account-1", deploymentId: "production-eu", operation: "view" });
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: "production-eu", getSession: () => ({ accountId: "account-1", deploymentId: "production-eu", deviceSessionId: "device-1" }) });
    let second: ((argv: readonly unknown[]) => void) | undefined;
    let open: ((event: { preventDefault(): void }, url: string) => void) | undefined;
    const system = {
      requestSingleInstanceLock: vi.fn(() => true),
      registerProtocolClient: vi.fn(),
      onSecondInstance: vi.fn((handler: (eventOrArgv: unknown, argv?: readonly unknown[]) => void) => { second = (argv) => handler(argv); }),
      onOpenUrl: vi.fn((handler: (event: { preventDefault(): void }, url: string) => void) => { open = handler; }),
    };
    const send = vi.fn();
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn(), send };
    const host = createDesktopHost({ window: { webContents: contents, webPreferences: windowPreferences, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender, deepLinks: { system, bridge } });
    await host.start();
    open?.({ preventDefault: vi.fn() }, `uniwork-office://open?ticket=${ticket}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(system.registerProtocolClient).toHaveBeenCalledWith("uniwork-office");
    expect(send).toHaveBeenCalledWith("desktop:launch-requested", { documentId: "01J8X4DOC0N1P2Q3R4S5T6U7", operation: "view" });
    expect(JSON.stringify(send.mock.calls)).not.toContain(ticket);
    expect(second).toBeDefined();
  });
});
