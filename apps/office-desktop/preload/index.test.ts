import { expect, it, vi } from "vitest";
import { createPreloadBridge, exposePreloadBridge } from "./index";

it("exposes only the typed bridge and forwards an allowlisted call", async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: true });
  const bridge = createPreloadBridge({ invoke });
  await expect(bridge.call("desktop:bootstrap", { sessionGeneration: "session_1234" })).resolves.toEqual({ ok: true });
  expect(invoke).toHaveBeenCalledWith("desktop:bootstrap", { sessionGeneration: "session_1234" });
  await expect(bridge.call("desktop:unknown" as never, {} as never)).rejects.toThrow(/allowlisted/);
});

it("uses context isolation's explicit main-world name", () => {
  const exposeInMainWorld = vi.fn();
  exposePreloadBridge({ exposeInMainWorld }, { invoke: vi.fn() });
  expect(exposeInMainWorld).toHaveBeenCalledWith("uniworkOffice", expect.objectContaining({ channels: expect.any(Array) }));
});

it("accepts only the narrow launch event and never forwards a ticket", () => {
  let listener: ((...args: unknown[]) => void) | undefined;
  const bridge = createPreloadBridge({ invoke: vi.fn(), on: (_channel, next) => { listener = next; } });
  const received: unknown[] = [];
  bridge.onLaunchRequested((event) => received.push(event));
  listener?.({}, { documentId: "doc-1", operation: "view", launch_ticket: "secret" });
  listener?.({}, { documentId: "doc-1", operation: "view" });
  expect(received).toEqual([{ documentId: "doc-1", operation: "view" }]);
  expect(JSON.stringify(received)).not.toContain("secret");
});

it("forwards only metadata from auth session change events", () => {
  let listener: ((...args: unknown[]) => void) | undefined;
  const bridge = createPreloadBridge({ invoke: vi.fn(), on: (_channel, next) => { listener = next; } });
  const received: unknown[] = [];
  bridge.onSessionChanged((metadata) => received.push(metadata));
  listener?.({}, { status: "signed-in", accountId: "account-1", deploymentId: "production-eu" });
  listener?.({}, { status: "signed-out", accessToken: "secret" });
  expect(received).toEqual([{ status: "signed-in", accountId: "account-1", deploymentId: "production-eu" }]);
  expect(JSON.stringify(received)).not.toContain("secret");
});

it("buffers a leave request that arrives before the renderer subscribes", () => {
  let listener: ((...args: unknown[]) => void) | undefined;
  const bridge = createPreloadBridge({ invoke: vi.fn(), on: (channel, next) => { if (channel === "desktop:leave-requested") listener = next; } });
  listener?.({}, { requestId: "leave-1", reason: "close" });
  const received: unknown[] = [];
  const unsubscribe = bridge.onLeaveRequested((event) => received.push(event));
  expect(received).toEqual([{ requestId: "leave-1", reason: "close" }]);
  unsubscribe();
  listener?.({}, { requestId: "leave-2", reason: "update" });
  expect(received).toHaveLength(1);
  listener?.({}, { requestId: "leave-3", reason: "not-a-reason" });
  listener?.({}, { requestId: "leave-4", reason: "close", extra: "secret" });
  expect(received).toHaveLength(1);
  expect(JSON.stringify(received)).not.toContain("secret");
});
