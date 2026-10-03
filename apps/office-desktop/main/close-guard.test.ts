import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { installPrimaryCloseGuard } from "./close-guard";
import { createDesktopLeaveCoordinator, type LeaveRequest } from "./leave";
import { createLaunchBridge, FakeExchangePort, registerDeepLinkSystem } from "./deep-links";

afterEach(() => { vi.useRealTimers(); });

class NativeWindow extends EventEmitter {
  closed = false;
  close() {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.emit("close", event);
    if (!event.defaultPrevented) this.closed = true;
    return event;
  }
}

function harness(options: { primary?: boolean; approved?: boolean; smoke?: boolean; confirmKeep?: () => Promise<boolean> } = {}) {
  const window = new NativeWindow();
  const requests: LeaveRequest[] = [];
  let approved = options.approved ?? false;
  const leave = createDesktopLeaveCoordinator({ send: (request) => { requests.push(request); }, confirmKeep: options.confirmKeep, timeoutMs: 100 });
  const installed = installPrimaryCloseGuard(window, leave, {
    primary: options.primary ?? true, smoke: options.smoke ?? false,
    isApproved: () => approved, approve: () => { approved = true; },
  });
  return { window, requests, leave, installed };
}

it("lets a losing lock process quit without a renderer or leave listener", () => {
  const window = new NativeWindow();
  const send = vi.fn();
  const leave = createDesktopLeaveCoordinator({ send });
  const bridge = createLaunchBridge({ exchange: new FakeExchangePort(), trustedDeploymentId: "lane", getSession: () => undefined });
  const registerProtocolClient = vi.fn();
  const quit = vi.fn(() => window.close());
  const registration = registerDeepLinkSystem({ requestSingleInstanceLock: () => false, quit, registerProtocolClient, onSecondInstance: vi.fn(), onOpenUrl: vi.fn() }, bridge);
  expect(installPrimaryCloseGuard(window, leave, { primary: registration.primary, smoke: false, isApproved: () => false, approve: vi.fn() })).toBe(false);
  expect(quit).toHaveBeenCalledOnce();
  expect(window.closed).toBe(true);
  expect(window.listenerCount("close")).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect(registerProtocolClient).not.toHaveBeenCalled();
});

it("keeps the primary window open while the renderer decides and after Stay", async () => {
  const { window, requests, leave, installed } = harness();
  expect(installed).toBe(true);
  expect(window.close().defaultPrevented).toBe(true);
  expect(window.closed).toBe(false);
  expect(requests).toHaveLength(1);
  leave.resolve({ ...requests[0]!, choice: "stay", proceeded: true });
  await vi.waitFor(() => expect(leave.busy).toBe(false));
  expect(window.closed).toBe(false);
});

it.each([true, false])("requires main Keep confirmation before primary close (confirmed=%s)", async (confirmed) => {
  let finish!: (value: boolean) => void;
  const { window, requests, leave } = harness({ confirmKeep: () => new Promise((resolve) => { finish = resolve; }) });
  window.close();
  leave.resolve({ ...requests[0]!, choice: "keep", proceeded: true });
  expect(window.closed).toBe(false);
  window.close();
  await Promise.resolve();
  expect(requests).toHaveLength(1);
  expect(window.closed).toBe(false);
  finish(confirmed);
  await vi.waitFor(() => expect(leave.busy).toBe(false));
  expect(window.closed).toBe(confirmed);
});

it("keeps the primary open if main verification cannot read the draft store", async () => {
  const { window, requests, leave } = harness({ confirmKeep: async () => { throw new Error("storage unavailable"); } });
  window.close();
  leave.resolve({ ...requests[0]!, choice: "keep", proceeded: true });
  await vi.waitFor(() => expect(leave.busy).toBe(false));
  expect(window.closed).toBe(false);
});

it("keeps an unanswered primary close fail closed after timeout", async () => {
  vi.useFakeTimers();
  const { window, leave } = harness();
  window.close();
  await vi.advanceTimersByTimeAsync(101);
  expect(leave.busy).toBe(false);
  expect(window.closed).toBe(false);
});

it.each([{ approved: true }, { smoke: true }])("preserves the existing approved or explicit smoke close exception (%j)", (options) => {
  const { window, requests } = harness(options);
  expect(window.close().defaultPrevented).toBe(false);
  expect(window.closed).toBe(true);
  expect(requests).toHaveLength(0);
});
