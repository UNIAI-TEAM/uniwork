// The drain's wiring to the running app (drain-env.ts): both server switches, what the person owes, and the drain
// of iOS's borrowed time for the person on screen — read from nowhere, delivered through owed.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  flags: { unichat_mobile_outbox_flush: true, unichat_mobile_background_send: true } as Record<string, boolean>,
  deliverOwed: vi.fn(async () => undefined),
  owesServer: vi.fn(() => true),
}));
vi.mock("../query-client", () => ({ queryClient: { tag: "qc" } }));
vi.mock("../remote-config", () => ({ readMobileFlag: (_qc: unknown, name: string) => deps.flags[name] }));
vi.mock("../owed", () => ({ deliverOwed: deps.deliverOwed, owesServer: deps.owesServer }));

import { GRACE_BUDGET_MS } from "./drain";
import { backgroundSendOn, owesNow, runningDrainEnv } from "./drain-env";

beforeEach(() => {
  vi.clearAllMocks();
  deps.flags = { unichat_mobile_outbox_flush: true, unichat_mobile_background_send: true };
});

describe("the running app's drain", () => {
  it("is the person on screen, read from nowhere, within the borrowed time", async () => {
    const env = runningDrainEnv("me");
    await expect(env.prepare()).resolves.toBe("me");
    await env.deliver("me");
    expect(deps.deliverOwed).toHaveBeenCalledWith({ tag: "qc" }, "me");
    expect(env.owes("me")).toBe(true);
    expect(env.budgetMs).toBe(GRACE_BUDGET_MS);
    expect(env.enabled()).toBe(true);
  });
});

describe("backgroundSendOn and owesNow", () => {
  it("needs both server switches: the outbox's re-send and the background send", () => {
    expect(backgroundSendOn()).toBe(true);
    deps.flags.unichat_mobile_background_send = false;
    expect(backgroundSendOn()).toBe(false);
    deps.flags = { unichat_mobile_outbox_flush: false, unichat_mobile_background_send: true };
    expect(backgroundSendOn()).toBe(false);
  });

  it("asks owed.ts", () => {
    deps.owesServer.mockReturnValueOnce(false);
    expect(owesNow("me")).toBe(false);
    expect(deps.owesServer).toHaveBeenCalledWith("me");
  });
});
