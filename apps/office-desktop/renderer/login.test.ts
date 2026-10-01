import { expect, it, vi } from "vitest";
import { createLoginController, loginStateFromMetadata } from "./login";

it("uses only start/cancel IPC commands and exposes no secret fields", async () => {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const controller = createLoginController({ call: async (channel, payload) => { calls.push({ channel, payload }); return { status: "pending", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" }; } }, "session_1234", "com.uniwork.office", "production-eu");
  await expect(controller.start()).resolves.toBe("pending");
  await expect(controller.cancel()).resolves.toBe("cancelled");
  expect(calls.map((call) => call.channel)).toEqual(["desktop:auth-start", "desktop:auth-cancel"]);
  expect(JSON.stringify(calls)).not.toMatch(/token|verifier|code|state/i);
});

it("maps host metadata to a renderer state", () => {
  expect(loginStateFromMetadata({ status: "signed-out" })).toBe("signed-out");
  expect(loginStateFromMetadata({ status: "pending" })).toBe("pending");
  expect(loginStateFromMetadata({ status: "signed-in", accountId: "account-1", deploymentId: "production-eu" })).toBe("signed-in");
  expect(loginStateFromMetadata({ status: "locked" })).toBe("locked");
  expect(loginStateFromMetadata({ status: "login-required" })).toBe("login-required");
});

it("renders error and cancelled states when command ports fail or no attempt exists", async () => {
  const failing = createLoginController({ call: async () => { throw new Error("disconnected"); } }, "session_1234", "com.uniwork.office", "production-eu");
  await expect(failing.start()).resolves.toBe("error");
  const idle = createLoginController({ call: async () => ({}) }, "session_1234", "com.uniwork.office", "production-eu");
  await expect(idle.cancel()).resolves.toBe("cancelled");
});

const pendingBridge = { call: async () => ({ status: "pending", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", expiresAt: Date.now() + 600_000 }) };

it("moves a pending attempt to expired once its TTL passes", async () => {
  vi.useFakeTimers();
  try {
    const states: string[] = [];
    const controller = createLoginController(pendingBridge, "session_1234", "com.uniwork.office", "production-eu");
    controller.subscribe((state) => states.push(state));
    await expect(controller.start()).resolves.toBe("pending");
    vi.advanceTimersByTime(599_999);
    expect(controller.getState()).toBe("pending");
    vi.advanceTimersByTime(1);
    expect(controller.getState()).toBe("expired");
    expect(states).toContain("expired");
  } finally {
    vi.useRealTimers();
  }
});

it("never flips a settled attempt to expired", async () => {
  vi.useFakeTimers();
  try {
    const controller = createLoginController(pendingBridge, "session_1234", "com.uniwork.office", "production-eu");
    await controller.start();
    controller.clearExpiry();
    vi.advanceTimersByTime(600_000);
    expect(controller.getState()).toBe("pending");
    await expect(controller.cancel()).resolves.toBe("cancelled");
    vi.advanceTimersByTime(600_000);
    expect(controller.getState()).toBe("cancelled");
  } finally {
    vi.useRealTimers();
  }
});
