// One drain of the outbox off screen (drain.ts): the person's queues read, what is owed delivered until nothing is
// on the wire (again after a blip, while the budget lasts), and an answer the platform acts on — nothing left, still owed (try again later), or nothing to do
// (signed out, switched off). Bounded by a budget; never throwing into a task.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installReportSink } from "../report";
import { drainOwed, stillOwed, type DrainEnv, type DrainOutcome } from "./drain";

function fakeEnv(over: Partial<DrainEnv> = {}): DrainEnv & { deliver: ReturnType<typeof vi.fn>; prepare: ReturnType<typeof vi.fn> } {
  let owed = true;
  return {
    prepare: vi.fn(async () => "me"),
    enabled: () => true,
    deliver: vi.fn(async () => void (owed = false)),
    owes: () => owed,
    budgetMs: 1_000,
    ...over,
  } as DrainEnv & { deliver: ReturnType<typeof vi.fn>; prepare: ReturnType<typeof vi.fn> };
}

const breadcrumbs: string[] = [];
beforeEach(() => {
  breadcrumbs.length = 0;
  installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void breadcrumbs.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
});
afterEach(() => {
  installReportSink(null);
  vi.useRealTimers();
});

describe("drainOwed", () => {
  it("delivers what the signed-in person owes and answers drained once nothing is left", async () => {
    const env = fakeEnv();
    await expect(drainOwed(env)).resolves.toBe("drained");
    expect(env.deliver).toHaveBeenCalledWith("me");
  });

  it("answers owed when something is still waiting after the delivery (the network went, the server is busy)", async () => {
    const env = fakeEnv({ owes: () => true });
    await expect(drainOwed(env)).resolves.toBe("owed");
  });

  // A send that fails on a blip as the app leaves (a Wi-Fi to cellular handoff, a 503) waits for its line's retry
  // timer, which would fire in a suspended app: the drain asks again itself, at the line's own first delays.
  it("asks again after a transient failure and answers drained when the next round goes, within its budget", async () => {
    vi.useFakeTimers();
    let rounds = 0;
    const env = fakeEnv({ deliver: vi.fn(async () => void (rounds += 1)), owes: () => rounds < 2, budgetMs: 25_000 });
    const outcome = drainOwed(env);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(env.deliver).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe("drained");
    expect(env.deliver).toHaveBeenCalledTimes(2);
  });

  it("asks at 2 s, 5 s and 15 s after the rounds before, then answers owed", async () => {
    vi.useFakeTimers();
    const env = fakeEnv({ owes: () => true, budgetMs: 120_000 });
    const outcome = drainOwed(env);
    await vi.advanceTimersByTimeAsync(0);
    expect(env.deliver).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(env.deliver).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(env.deliver).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(outcome).resolves.toBe("owed");
    expect(env.deliver).toHaveBeenCalledTimes(4);
  });

  it("answers owed at once rather than wait for a round its budget has no room for", async () => {
    vi.useFakeTimers();
    const env = fakeEnv({ owes: () => true, budgetMs: 6_000 });
    const outcome = drainOwed(env);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(outcome).resolves.toBe("owed");
    expect(env.deliver).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  // The pause is measured on the wall clock, the budget on the timers: a clock set back while a round runs lets a
  // pause start that outlives the budget. The budget lets go on time, and the pause that ends after it starts no
  // round the OS no longer lends time for.
  it("lets go of a round whose pause outlives the budget (the wall clock set back)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const env = fakeEnv({
      owes: () => true,
      budgetMs: 6_000,
      deliver: vi.fn(async () => {
        calls += 1;
        if (calls === 1) vi.setSystemTime(Date.now() - 10_000);
      }),
    });
    const outcome = drainOwed(env);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(outcome).resolves.toBe("timeout");
    expect(env.deliver).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(env.deliver).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has nothing to do with nothing owed, and says drained without asking the server", async () => {
    const env = fakeEnv({ owes: () => false });
    await expect(drainOwed(env)).resolves.toBe("drained");
    expect(env.deliver).not.toHaveBeenCalled();
  });

  it("reads nothing and sends nothing for a phone nobody is signed in on", async () => {
    const env = fakeEnv({ prepare: vi.fn(async () => null) });
    await expect(drainOwed(env)).resolves.toBe("signed-out");
    expect(env.deliver).not.toHaveBeenCalled();
  });

  it("leaves the queues alone while the server's switches are off", async () => {
    const env = fakeEnv({ enabled: () => false });
    await expect(drainOwed(env)).resolves.toBe("paused");
    expect(env.deliver).not.toHaveBeenCalled();
  });

  it("lets go at the end of its budget, the sends going on as long as the runtime does", async () => {
    vi.useFakeTimers();
    const env = fakeEnv({ deliver: vi.fn(() => new Promise<void>(() => undefined)), budgetMs: 500 });
    const outcome = drainOwed(env);
    await vi.advanceTimersByTimeAsync(500);
    await expect(outcome).resolves.toBe("timeout");
  });

  it("answers failed, as a breadcrumb, when the queues or the session cannot be read", async () => {
    const env = fakeEnv({ prepare: vi.fn(async () => Promise.reject(new Error("keychain"))) });
    await expect(drainOwed(env)).resolves.toBe("failed");
    expect(breadcrumbs).toEqual(["outbox not drained in the background"]);
  });
});

describe("stillOwed", () => {
  it.each<[DrainOutcome, boolean]>([
    ["drained", false],
    ["signed-out", false],
    ["paused", false],
    ["owed", true],
    ["timeout", true],
    ["failed", true],
  ])("%s → try again later: %s", (outcome, again) => {
    expect(stillOwed(outcome)).toBe(again);
  });
});
