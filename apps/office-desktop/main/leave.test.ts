import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopLeaveCoordinator, createLeaveIpcHandler, type LeaveRequest, type LeaveResolution } from "./leave";

afterEach(() => { vi.useRealTimers(); });

function harness(overrides: Partial<Parameters<typeof createDesktopLeaveCoordinator>[0]> = {}) {
  const requests: LeaveRequest[] = [];
  const coordinator = createDesktopLeaveCoordinator({
    send: (request) => { requests.push(request); },
    idFactory: (() => { let sequence = 0; return () => `leave-${++sequence}`; })(),
    timeoutMs: 1_000,
    ...overrides,
  });
  return { coordinator, requests };
}

const answer = (requestId: string, choice: LeaveResolution["choice"], proceeded = true): LeaveResolution => ({ requestId, choice, proceeded });

describe("desktop leave coordinator", () => {
  it("resolves one request and rejects stale or duplicate ids", async () => {
    const { coordinator, requests } = harness();
    const pending = coordinator.request("close");
    expect(requests).toHaveLength(1);
    expect(coordinator.busy).toBe(true);
    expect(coordinator.resolve(answer("leave-stale", "save", true))).toBe(false);
    expect(coordinator.resolve(answer(requests[0]!.requestId, "stay", false))).toBe(true);
    await expect(pending).resolves.toMatchObject({ choice: "stay", proceeded: false });
    // Duplicate: the request is settled and the id is no longer current.
    expect(coordinator.resolve(answer(requests[0]!.requestId, "save", true))).toBe(false);
    expect(coordinator.busy).toBe(false);
  });

  it("fails closed on a timeout and never blocks a later request", async () => {
    vi.useFakeTimers();
    const { coordinator, requests } = harness();
    const pending = coordinator.request("close");
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toMatchObject({ choice: "stay", proceeded: false, code: "timeout" });
    expect(coordinator.busy).toBe(false);
    const second = coordinator.request("close");
    expect(coordinator.busy).toBe(true);
    coordinator.resolve(answer(requests[1]!.requestId, "stay", false));
    await expect(second).resolves.toMatchObject({ choice: "stay", proceeded: false });
    expect(requests[1]!.requestId).not.toBe(requests[0]!.requestId);
  });

  it("never proceeds on a stay answer, even when the renderer claims proceeded", async () => {
    const { coordinator, requests } = harness({ confirmSave: async () => true });
    const pending = coordinator.request("close");
    coordinator.resolve(answer(requests[0]!.requestId, "stay", true));
    await expect(pending).resolves.toMatchObject({ choice: "stay", proceeded: false });
  });

  it("fails closed when a verifier cannot read the store", async () => {
    const { coordinator, requests } = harness({ confirmKeep: async () => false });
    const pending = coordinator.request("logout");
    coordinator.resolve(answer(requests[0]!.requestId, "keep", true));
    await expect(pending).resolves.toMatchObject({ choice: "stay", proceeded: false, code: "unconfirmed" });
  });

  it("refuses a second decision while one is outstanding", async () => {
    const { coordinator, requests } = harness();
    const first = coordinator.request("close");
    await expect(coordinator.request("logout")).resolves.toMatchObject({ choice: "stay", proceeded: false, code: "busy" });
    coordinator.resolve(answer(requests[0]!.requestId, "stay", false));
    await first;
    expect(requests).toHaveLength(1);
  });

  it("never proceeds on keep without a durable row main can see", async () => {
    const confirmKeep = vi.fn(async () => false);
    const { coordinator, requests } = harness({ confirmKeep });
    const pending = coordinator.request("logout");
    coordinator.resolve(answer(requests[0]!.requestId, "keep", true));
    await expect(pending).resolves.toMatchObject({ choice: "stay", proceeded: false, code: "unconfirmed" });
    expect(confirmKeep).toHaveBeenCalledOnce();
  });

  it("requires a save receipt observed after the request", async () => {
    const seen: number[] = [];
    const { coordinator, requests } = harness({ confirmSave: async (issuedAt) => { seen.push(issuedAt); return seen.length > 1; } });
    const first = coordinator.request("close");
    coordinator.resolve(answer(requests[0]!.requestId, "save", true));
    await expect(first).resolves.toMatchObject({ choice: "stay", proceeded: false, code: "unconfirmed" });
    const second = coordinator.request("close");
    coordinator.resolve(answer(requests[1]!.requestId, "save", true));
    await expect(second).resolves.toMatchObject({ choice: "save", proceeded: true });
  });

  it("proceeds on discard only when the draft row is gone", async () => {
    const confirmDiscard = vi.fn(async () => true);
    const { coordinator, requests } = harness({ confirmDiscard });
    const pending = coordinator.request("update");
    coordinator.resolve(answer(requests[0]!.requestId, "discard", true));
    await expect(pending).resolves.toMatchObject({ choice: "discard", proceeded: true });
    expect(confirmDiscard).toHaveBeenCalledOnce();
  });

  it("forwards the renderer answer through the IPC handler", async () => {
    const { coordinator, requests } = harness();
    const handler = createLeaveIpcHandler(coordinator);
    const pending = coordinator.request("close");
    expect(handler["desktop:leave-resolved"]({ requestId: "leave-other", choice: "save", proceeded: true })).toEqual({ resolved: false });
    expect(handler["desktop:leave-resolved"]({ requestId: requests[0]!.requestId, choice: "save", proceeded: true })).toEqual({ resolved: true });
    await expect(pending).resolves.toMatchObject({ choice: "save", proceeded: true });
  });
});
