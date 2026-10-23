// The tasks that drain the outbox off screen (drain-tasks.ts): Android's headless task answers the job that started
// it; iOS's scheduled task drops itself once nothing is owed; both registered at the app's entry, each on its own
// platform only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rn = vi.hoisted(() => ({ Platform: { OS: "android" }, AppRegistry: { registerHeadlessTask: vi.fn() } }));
vi.mock("react-native", () => rn);
const taskManager = vi.hoisted(() => ({ defineTask: vi.fn() }));
vi.mock("expo-task-manager", () => taskManager);
vi.mock("expo-background-task", () => ({ BackgroundTaskResult: { Success: 1, Failed: 2 } }));
const app = vi.hoisted(() => ({ native: { tag: "native" }, scheduled: { tag: "scheduled" }, task: { tag: "task" } }));
vi.mock("./native-drain", () => ({ nativeDrain: app.native }));
vi.mock("./background-send", () => ({ scheduledDrain: app.scheduled }));
vi.mock("./task-env", () => ({ taskDrainEnv: app.task }));

import { installReportSink } from "../report";
import { DRAIN_TASK, SCHEDULED_DRAIN_TASK, type DrainEnv, type DrainOutcome } from "./drain";
import { appDrainTaskEnv, registerOutboxDrainTasks, runDrainTask, runScheduledDrain, type DrainTaskEnv } from "./drain-tasks";

const drainEnv = (outcome: DrainOutcome | "never"): DrainEnv => ({
  prepare: async () => (outcome === "signed-out" ? null : "me"),
  enabled: () => outcome !== "paused",
  deliver: () => (outcome === "never" ? new Promise<void>(() => undefined) : outcome === "failed" ? Promise.reject(new Error("boom")) : Promise.resolve()),
  owes: () => outcome === "owed" || outcome === "failed" || outcome === "never",
  budgetMs: 1_000,
});

function fakeEnv(outcome: DrainOutcome | "never" = "drained"): DrainTaskEnv {
  return {
    native: {
      beginGrace: vi.fn(async () => null),
      endGrace: vi.fn(async () => undefined),
      scheduleDrain: vi.fn(),
      cancelDrain: vi.fn(),
      drainFinished: vi.fn((_token: string, _owed: boolean) => undefined),
    },
    scheduled: { keep: vi.fn(async () => undefined), drop: vi.fn(async () => undefined) },
    task: drainEnv(outcome),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installReportSink({ captureException: vi.fn(), addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() });
  rn.Platform.OS = "android";
});

describe("Android's drain task", () => {
  it.each<[DrainOutcome, boolean]>([
    ["drained", false],
    ["owed", true],
    ["failed", true],
    ["signed-out", false],
    ["paused", false],
  ])("answers its job after a %s drain: still owed %s", async (outcome, owed) => {
    const env = fakeEnv(outcome);
    await runDrainTask({ token: "job-1" }, env);
    expect(env.native.drainFinished).toHaveBeenCalledWith("job-1", owed);
  });

  it("answers still owed when the drain runs out of time", async () => {
    vi.useFakeTimers();
    try {
      const env = fakeEnv("never");
      const run = runDrainTask({ token: "job-2" }, env);
      await vi.advanceTimersByTimeAsync(1_000);
      await run;
      expect(env.native.drainFinished).toHaveBeenCalledWith("job-2", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs nothing for a start without a job's token", async () => {
    const env = fakeEnv();
    for (const data of [undefined, {}, { token: 3 }, { token: "" }]) await runDrainTask(data, env);
    expect(env.native.drainFinished).not.toHaveBeenCalled();
  });
});

describe("iOS's scheduled drain", () => {
  it("drops itself once nothing is owed, and stays while something is", async () => {
    const drained = fakeEnv("drained");
    await expect(runScheduledDrain(drained)).resolves.toBe("drained");
    expect(drained.scheduled.drop).toHaveBeenCalled();
    const owed = fakeEnv("owed");
    await expect(runScheduledDrain(owed)).resolves.toBe("owed");
    expect(owed.scheduled.drop).not.toHaveBeenCalled();
  });
});

describe("registerOutboxDrainTasks", () => {
  it("Android: registers the headless task the job starts, which drains and answers", async () => {
    const env = fakeEnv();
    registerOutboxDrainTasks(env);
    expect(rn.AppRegistry.registerHeadlessTask).toHaveBeenCalledWith(DRAIN_TASK, expect.any(Function));
    expect(taskManager.defineTask).not.toHaveBeenCalled();
    const provider = vi.mocked(rn.AppRegistry.registerHeadlessTask).mock.calls[0]![1] as () => (data: unknown) => Promise<void>;
    await provider()({ token: "job-3" });
    expect(env.native.drainFinished).toHaveBeenCalledWith("job-3", false);
  });

  it("iOS: defines the scheduled task, which drains and reports success to the system", async () => {
    rn.Platform.OS = "ios";
    const env = fakeEnv("owed");
    registerOutboxDrainTasks(env);
    expect(rn.AppRegistry.registerHeadlessTask).not.toHaveBeenCalled();
    const [name, executor] = vi.mocked(taskManager.defineTask).mock.calls[0] as unknown as [string, () => Promise<number>];
    expect(name).toBe(SCHEDULED_DRAIN_TASK);
    await expect(executor()).resolves.toBe(1);
  });

  it("registers nothing elsewhere, and uses the app's env by default", () => {
    rn.Platform.OS = "web";
    registerOutboxDrainTasks();
    expect(rn.AppRegistry.registerHeadlessTask).not.toHaveBeenCalled();
    expect(taskManager.defineTask).not.toHaveBeenCalled();
    expect(appDrainTaskEnv).toEqual({ native: app.native, scheduled: app.scheduled, task: app.task });
  });
});
