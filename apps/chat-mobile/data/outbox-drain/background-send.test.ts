// What keeps the outbox going once UniChat is off screen (background-send.ts): iOS borrows time as the app leaves and
// keeps a scheduled task while something is still owed; Android hands it to a WorkManager job that needs a network;
// both stand down when nothing is owed or the server's switches are off. Back on screen, Android's job goes and iOS's
// task goes if its last run left it owing nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rn = vi.hoisted(() => ({ Platform: { OS: "android" } }));
vi.mock("react-native", () => rn);
vi.mock("expo-background-task", () => ({
  registerTaskAsync: vi.fn(async () => undefined),
  unregisterTaskAsync: vi.fn(async () => undefined),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
const envs = vi.hoisted(() => ({
  enabled: true,
  owes: true,
  runningDrainEnv: vi.fn((userId: string) => ({ tag: "running", userId })),
}));
vi.mock("./drain-env", () => ({
  backgroundSendOn: () => envs.enabled,
  owesNow: () => envs.owes,
  runningDrainEnv: envs.runningDrainEnv,
}));
const native = vi.hoisted(() => ({
  beginGrace: vi.fn(async (): Promise<number | null> => 4),
  endGrace: vi.fn(async () => undefined),
  scheduleDrain: vi.fn(),
  cancelDrain: vi.fn(),
  drainFinished: vi.fn(),
}));
vi.mock("./native-drain", () => ({ nativeDrain: native }));

import { installReportSink } from "../report";
import { appBackgroundSendEnv, backInFront, keepSendingOffScreen, type BackgroundSendEnv } from "./background-send";
import type { DrainEnv, DrainOutcome } from "./drain";
import { scheduledDrain } from "./scheduled-drain";

const drainEnv = (outcome: DrainOutcome): DrainEnv => ({
  prepare: async () => "me",
  enabled: () => true,
  deliver: () => Promise.resolve(),
  owes: () => outcome === "owed",
  budgetMs: 1_000,
});

function fakeEnv(os: string, over: Partial<BackgroundSendEnv> = {}) {
  const order: string[] = [];
  const env: BackgroundSendEnv = {
    os,
    native: {
      beginGrace: vi.fn(async () => {
        order.push("begin");
        return 9;
      }),
      endGrace: vi.fn(async () => void order.push("end")),
      scheduleDrain: vi.fn(),
      cancelDrain: vi.fn(),
      drainFinished: vi.fn(),
    },
    scheduled: {
      keep: vi.fn(async () => void order.push("keep")),
      drop: vi.fn(async () => void order.push("drop")),
      run: vi.fn(),
      settle: vi.fn(async () => void order.push("settle")),
    },
    enabled: () => true,
    owes: () => true,
    running: vi.fn(() => {
      order.push("drain");
      return drainEnv("drained");
    }),
    ...over,
  };
  return { env, order };
}

const breadcrumbs: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  breadcrumbs.length = 0;
  installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void breadcrumbs.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
  Object.assign(envs, { enabled: true, owes: true });
  rn.Platform.OS = "android";
});

describe("leaving the screen with something owed", () => {
  it("iOS: borrows time, keeps the scheduled task, drains, gives the time back and drops the task once nothing is owed", async () => {
    const { env, order } = fakeEnv("ios");
    await keepSendingOffScreen("me", env);
    expect(env.running).toHaveBeenCalledWith("me");
    expect(order).toEqual(["begin", "keep", "drain", "end", "drop"]);
  });

  it("iOS: keeps the scheduled task when the borrowed time ends with something still owed", async () => {
    const { env, order } = fakeEnv("ios", { running: () => drainEnv("owed") });
    await keepSendingOffScreen("me", env);
    expect(order).toEqual(["begin", "keep", "end"]);
  });

  it("iOS: drains all the same when the system lends no time, and gives back none", async () => {
    const { env, order } = fakeEnv("ios");
    vi.mocked(env.native.beginGrace).mockResolvedValueOnce(null);
    await keepSendingOffScreen("me", env);
    expect(order).toEqual(["keep", "drain", "drop"]);
    expect(env.native.endGrace).not.toHaveBeenCalled();
  });

  it("iOS: gives the time back even when the drain throws, and keeps the task", async () => {
    const { env, order } = fakeEnv("ios", {
      running: () => {
        throw new Error("no env");
      },
    });
    await expect(keepSendingOffScreen("me", env)).rejects.toThrow("no env");
    expect(order).toEqual(["begin", "keep", "end"]);
  });

  it("iOS: drains within the borrowed time even when the scheduled task cannot be kept", async () => {
    const { env, order } = fakeEnv("ios");
    vi.mocked(env.scheduled.keep).mockRejectedValueOnce(new Error("not permitted"));
    await keepSendingOffScreen("me", env);
    expect(order).toEqual(["begin", "drain", "end", "drop"]);
    expect(breadcrumbs).toContain("scheduled drain not kept");
  });

  it("Android: hands it to the job, expedited, and drains nothing itself", async () => {
    const { env } = fakeEnv("android");
    await keepSendingOffScreen("me", env);
    expect(env.native.scheduleDrain).toHaveBeenCalledWith(true);
    expect(env.running).not.toHaveBeenCalled();
    expect(env.native.beginGrace).not.toHaveBeenCalled();
  });

  it("stands down when nothing is owed: Android's job goes, iOS's task goes, no time is borrowed", async () => {
    for (const os of ["android", "ios"]) {
      const { env } = fakeEnv(os, { owes: () => false });
      await keepSendingOffScreen("me", env);
      expect(env.native.scheduleDrain).not.toHaveBeenCalled();
      expect(env.native.beginGrace).not.toHaveBeenCalled();
      expect(env.native.cancelDrain).toHaveBeenCalledTimes(os === "android" ? 1 : 0);
      expect(env.scheduled.drop).toHaveBeenCalledTimes(os === "ios" ? 1 : 0);
    }
  });

  it("stands down while the server's switches are off, owed or not", async () => {
    const { env } = fakeEnv("android", { enabled: () => false });
    await keepSendingOffScreen("me", env);
    expect(env.native.scheduleDrain).not.toHaveBeenCalled();
    expect(env.native.cancelDrain).toHaveBeenCalled();
  });

  it("does nothing on a platform with neither half (web)", async () => {
    const { env, order } = fakeEnv("web");
    await keepSendingOffScreen("me", env);
    expect(order).toEqual([]);
    expect(env.native.scheduleDrain).not.toHaveBeenCalled();
  });
});

describe("back on screen", () => {
  it("Android: the job waiting for a network goes (the screens send now); iOS: the drop a run left for later", async () => {
    const android = fakeEnv("android").env;
    await backInFront(android);
    expect(android.native.cancelDrain).toHaveBeenCalled();
    expect(android.scheduled.settle).not.toHaveBeenCalled();
    const ios = fakeEnv("ios");
    await backInFront(ios.env);
    expect(ios.env.native.cancelDrain).not.toHaveBeenCalled();
    expect(ios.order).toEqual(["settle"]);
  });
});

describe("the app's env", () => {
  it("reads the platform, the switches and the queues of the running app", () => {
    rn.Platform.OS = "ios";
    expect(appBackgroundSendEnv.os).toBe("ios");
    expect(appBackgroundSendEnv.native).toBe(native);
    expect(appBackgroundSendEnv.scheduled).toBe(scheduledDrain);
    expect(appBackgroundSendEnv.running("me")).toEqual({ tag: "running", userId: "me" });
    envs.enabled = false;
    envs.owes = false;
    expect(appBackgroundSendEnv.enabled()).toBe(false);
    expect(appBackgroundSendEnv.owes("me")).toBe(false);
  });
});
