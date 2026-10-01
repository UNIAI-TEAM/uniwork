import { expect, it } from "vitest";
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
