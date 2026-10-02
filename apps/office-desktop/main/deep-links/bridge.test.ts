import { describe, expect, it, vi } from "vitest";
import { createLaunchBridge, registerDeepLinkSystem } from "./bridge";
import { FakeExchangePort } from "./exchange";

const ticket = `ticket_${"b".repeat(32)}`;
const url = `uniwork-office://open?ticket=${ticket}`;
const session = { accountId: "account-1", deploymentId: "production-eu", deviceSessionId: "device-1" } as const;

describe("launch bridge routing", () => {
  it("routes cold and warm delivery through one handler and emits only id/operation", async () => {
    const exchange = new FakeExchangePort();
    exchange.issueTicket({ ticket, accountId: session.accountId, deploymentId: session.deploymentId, operation: "edit" });
    const events: unknown[] = [];
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: session.deploymentId, getSession: () => session });
    bridge.subscribe((event) => events.push(event));
    await expect(bridge.handleColdStart(["office.exe", url])).resolves.toMatchObject({ status: "opened", documentId: expect.any(String), operation: "edit" });
    await expect(bridge.handleSecondInstance(["office.exe", url])).resolves.toEqual({ status: "refused", reason: "replayed" });
    await expect(bridge.handleOpenUrl(url)).resolves.toEqual({ status: "refused", reason: "replayed" });
    expect(exchange.calls).toBe(1);
    expect(events).toEqual([{ documentId: "01J8X4DOC0N1P2Q3R4S5T6U7", operation: "edit" }]);
    expect(JSON.stringify(events)).not.toContain(ticket);
  });

  it("checks local session before exchange and asks for login without metadata", async () => {
    const exchange = new FakeExchangePort();
    exchange.issueTicket({ ticket, accountId: session.accountId, deploymentId: session.deploymentId, operation: "view" });
    const prompt = vi.fn();
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: session.deploymentId, getSession: () => undefined, onLoginRequired: prompt });
    await expect(bridge.handleUrl(url)).resolves.toEqual({ status: "login_required", reason: "signed_out" });
    expect(exchange.calls).toBe(0);
    expect(prompt).toHaveBeenCalledWith("signed_out");
  });

  it("maps a ticket owned by another account to a login outcome without descriptor metadata", async () => {
    const exchange = new FakeExchangePort();
    exchange.issueTicket({ ticket, accountId: "account-2", deploymentId: session.deploymentId, operation: "edit" });
    const prompt = vi.fn();
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: session.deploymentId, getSession: () => session, onLoginRequired: prompt });
    const outcome = await bridge.handleUrl(url);
    expect(outcome).toEqual({ status: "login_required", reason: "account_mismatch" });
    expect(JSON.stringify(outcome)).not.toContain("01J8X4DOC");
    expect(prompt).toHaveBeenCalledWith("account_mismatch");
  });

  it("does not exchange invalid, expired, or replayed tickets twice", async () => {
    let now = 0;
    const exchange = new FakeExchangePort({ now: () => now, clockSkewMs: 0 });
    exchange.issueTicket({ ticket, accountId: session.accountId, deploymentId: session.deploymentId, operation: "view", ttlMs: 1 });
    now = 2;
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: session.deploymentId, getSession: () => session });
    await expect(bridge.handleUrl(url)).resolves.toEqual({ status: "refused", reason: "expired" });
    await expect(bridge.handleUrl(url)).resolves.toEqual({ status: "refused", reason: "replayed" });
    await expect(bridge.handleUrl("uniwork-office://open?ticket=bad")).resolves.toEqual({ status: "refused", reason: "invalid_ticket" });
    expect(exchange.calls).toBe(1);
  });

  it("registers one primary scheme owner and feeds both warm callbacks", async () => {
    const exchange = new FakeExchangePort();
    exchange.issueTicket({ ticket, accountId: session.accountId, deploymentId: session.deploymentId, operation: "view" });
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: session.deploymentId, getSession: () => session });
    const second = vi.fn();
    const open = vi.fn();
    const system = { requestSingleInstanceLock: vi.fn(() => true), registerProtocolClient: vi.fn(), onSecondInstance: vi.fn((handler) => second.mockImplementation(handler)), onOpenUrl: vi.fn((handler) => open.mockImplementation(handler)) };
    const registration = registerDeepLinkSystem(system, bridge);
    expect(registration.primary).toBe(true);
    expect(system.registerProtocolClient).toHaveBeenCalledWith("uniwork-office");
    await second(["office.exe", url]);
    await open({ preventDefault: vi.fn() }, url);
    expect(exchange.calls).toBe(1);
  });

  it("routes a Windows second-instance auth callback to the login manager", async () => {
    const exchange = new FakeExchangePort();
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: session.deploymentId, getSession: () => session });
    const authCallback = vi.fn();
    let second: ((eventOrArgv: unknown, argv?: readonly unknown[]) => void) | undefined;
    const system = {
      requestSingleInstanceLock: vi.fn(() => true), registerProtocolClient: vi.fn(),
      onSecondInstance: vi.fn((handler: (eventOrArgv: unknown, argv?: readonly unknown[]) => void) => { second = handler; }),
      onOpenUrl: vi.fn(),
    };
    registerDeepLinkSystem(system, bridge, authCallback);
    second?.(["office.exe", "uniwork-office://auth/callback?code=code_abc&state=state_abc"]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(authCallback).toHaveBeenCalledWith("uniwork-office://auth/callback?code=code_abc&state=state_abc");
    expect(exchange.calls).toBe(0);
  });

  it("drains a macOS cold-start open-url exactly once through the shared router", async () => {
    const exchange = new FakeExchangePort();
    exchange.issueTicket({ ticket, accountId: session.accountId, deploymentId: session.deploymentId, operation: "edit" });
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: session.deploymentId, getSession: () => session });
    const delivered: string[][] = [[url], []];
    const system = {
      requestSingleInstanceLock: vi.fn(() => true), registerProtocolClient: vi.fn(),
      onSecondInstance: vi.fn(), onOpenUrl: vi.fn(),
      takePendingOpenUrls: vi.fn(() => delivered.shift() ?? []),
    };
    expect(registerDeepLinkSystem(system, bridge).primary).toBe(true);
    await vi.waitFor(() => expect(exchange.calls).toBe(1));
    expect(system.takePendingOpenUrls).toHaveBeenCalledOnce();
  });

  it("routes a drained cold-start auth callback to the login manager", async () => {
    const exchange = new FakeExchangePort();
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: session.deploymentId, getSession: () => session });
    const authCallback = vi.fn();
    const authUrl = "uniwork-office://auth/callback?code=code_abc&state=state_abc";
    const system = {
      requestSingleInstanceLock: vi.fn(() => true), registerProtocolClient: vi.fn(),
      onSecondInstance: vi.fn(), onOpenUrl: vi.fn(),
      takePendingOpenUrls: vi.fn(() => [authUrl]),
    };
    registerDeepLinkSystem(system, bridge, authCallback);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(authCallback).toHaveBeenCalledWith(authUrl);
    expect(exchange.calls).toBe(0);
  });

  it("quits a secondary process without registering a second protocol owner", () => {
    const exchange = new FakeExchangePort();
    const bridge = createLaunchBridge({ exchange, trustedDeploymentId: "production-eu", getSession: () => session });
    const quit = vi.fn();
    const system = {
      requestSingleInstanceLock: vi.fn(() => false),
      registerProtocolClient: vi.fn(),
      onSecondInstance: vi.fn(),
      onOpenUrl: vi.fn(),
      quit,
    };
    expect(registerDeepLinkSystem(system, bridge).primary).toBe(false);
    expect(quit).toHaveBeenCalledOnce();
    expect(system.registerProtocolClient).not.toHaveBeenCalled();
  });
});
