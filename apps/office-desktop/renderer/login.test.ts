import { expect, it, vi } from "vitest";
import { createLoginController, loginStateFromMetadata, renderLoginScreen } from "./login";

function root() {
  const attrs: Record<string, string> = {};
  return { node: { textContent: "", setAttribute: (name: string, value: string) => { attrs[name] = value; } }, attrs };
}

it.each(["signed-out", "pending", "error", "cancelled", "signed-in"] as const)("renders the %s state through t()", (state) => {
  const { node, attrs } = root();
  const t = vi.fn((key: string) => `translated:${key}`);
  renderLoginScreen(node, state, { t: t as never, registry: { button: vi.fn() } });
  expect(node.textContent).toContain("translated:login.title");
  expect(attrs["data-login-state"]).toBe(state);
  expect(t).toHaveBeenCalled();
});

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
});

it("renders error and cancelled states when command ports fail or no attempt exists", async () => {
  const failing = createLoginController({ call: async () => { throw new Error("disconnected"); } }, "session_1234", "com.uniwork.office", "production-eu");
  await expect(failing.start()).resolves.toBe("error");
  const idle = createLoginController({ call: async () => ({}) }, "session_1234", "com.uniwork.office", "production-eu");
  await expect(idle.cancel()).resolves.toBe("cancelled");
});
