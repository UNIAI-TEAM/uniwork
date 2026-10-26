// iOS's scheduled drain (scheduled-drain.ts): kept while something is owed, and never unregistered while a run of it
// is under way — expo-task-manager completes the BGProcessingTask only through the registration, so a run that finds
// nothing owed leaves its drop for the screen's return.
import { describe, expect, it, vi } from "vitest";

const backgroundTask = vi.hoisted(() => ({
  registerTaskAsync: vi.fn(async () => undefined),
  unregisterTaskAsync: vi.fn(async () => undefined),
}));
vi.mock("expo-background-task", () => backgroundTask);

import { SCHEDULED_DRAIN_TASK, type DrainOutcome } from "./drain";
import { createScheduledDrain, scheduledDrain } from "./scheduled-drain";

function fakeRegistration() {
  const calls: string[] = [];
  const registration = {
    register: vi.fn(async () => void calls.push("register")),
    unregister: vi.fn(async () => void calls.push("unregister")),
  };
  return { registration, calls };
}

describe("createScheduledDrain", () => {
  it("keeps and drops the task outside a run", async () => {
    const { registration, calls } = fakeRegistration();
    const scheduled = createScheduledDrain(registration);
    await scheduled.keep();
    await scheduled.drop();
    expect(calls).toEqual(["register", "unregister"]);
  });

  it("a run that finds nothing owed answers first and leaves the drop for the screen's return", async () => {
    const { registration, calls } = fakeRegistration();
    const scheduled = createScheduledDrain(registration);
    await expect(scheduled.run(async () => "drained")).resolves.toBe("drained");
    expect(calls).toEqual([]);
    await scheduled.settle();
    expect(calls).toEqual(["unregister"]);
    // Settled once: the next return has nothing to drop.
    await scheduled.settle();
    expect(calls).toEqual(["unregister"]);
  });

  it.each<[DrainOutcome, boolean]>([
    ["drained", true],
    ["signed-out", true],
    ["paused", true],
    ["owed", false],
    ["timeout", false],
    ["failed", false],
  ])("after a %s run, back on screen drops the task: %s", async (outcome, dropped) => {
    const { registration } = fakeRegistration();
    const scheduled = createScheduledDrain(registration);
    await scheduled.run(async () => outcome);
    await scheduled.settle();
    expect(registration.unregister).toHaveBeenCalledTimes(dropped ? 1 : 0);
  });

  it("a drop asked for during a run waits for it, and the run's own finding has the last word", async () => {
    const { registration } = fakeRegistration();
    const scheduled = createScheduledDrain(registration);
    let finish: (outcome: DrainOutcome) => void = () => undefined;
    const run = scheduled.run(() => new Promise<DrainOutcome>((resolve) => (finish = resolve)));
    await scheduled.drop();
    await scheduled.settle();
    expect(registration.unregister).not.toHaveBeenCalled();
    finish("owed");
    await run;
    await scheduled.settle();
    expect(registration.unregister).not.toHaveBeenCalled();
  });

  it("a drop asked for during a run that ends drained happens on the screen's return", async () => {
    const { registration } = fakeRegistration();
    const scheduled = createScheduledDrain(registration);
    let finish: (outcome: DrainOutcome) => void = () => undefined;
    const run = scheduled.run(() => new Promise<DrainOutcome>((resolve) => (finish = resolve)));
    await scheduled.drop();
    finish("drained");
    await run;
    expect(registration.unregister).not.toHaveBeenCalled();
    await scheduled.settle();
    expect(registration.unregister).toHaveBeenCalledTimes(1);
  });

  it("keeping the task again cancels a drop left for later", async () => {
    const { registration } = fakeRegistration();
    const scheduled = createScheduledDrain(registration);
    await scheduled.run(async () => "drained");
    await scheduled.keep();
    await scheduled.settle();
    expect(registration.unregister).not.toHaveBeenCalled();
  });
});

describe("the app's scheduled drain", () => {
  it("registers through expo-background-task, every 15 minutes at the soonest, and unregisters the same name", async () => {
    await scheduledDrain.keep();
    expect(backgroundTask.registerTaskAsync).toHaveBeenCalledWith(SCHEDULED_DRAIN_TASK, { minimumInterval: 15 });
    await scheduledDrain.drop();
    expect(backgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(SCHEDULED_DRAIN_TASK);
  });
});
