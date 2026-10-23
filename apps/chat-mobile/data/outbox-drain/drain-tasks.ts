// The tasks that drain the outbox with UniChat off screen (background-send.ts says when each is asked for): Android's
// headless JavaScript task, which the WorkManager job starts (modules/unichat-background › HeadlessDrainRunner.kt)
// and which answers the job; iOS's scheduled task (expo-background-task), dropped once nothing is owed. Both run the
// drain of a task (task-env.ts: the runtime booted, the queues read, as nothing on screen did). Registered at the
// app's entry (background-tasks.ts), so a headless runtime or a background launch has them.
//
// iOS's run never unregisters its own task: expo-task-manager could not complete it then (scheduled-drain.ts).
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { AppRegistry, Platform } from "react-native";
import { pathOf } from "@/lib/unknown-shape";
import { createLogger } from "../logger";
import { DRAIN_TASK, SCHEDULED_DRAIN_TASK, drainOwed, stillOwed, type DrainEnv, type DrainOutcome } from "./drain";
import { nativeDrain, type NativeDrain } from "./native-drain";
import { scheduledDrain, type ScheduledDrain } from "./scheduled-drain";
import { taskDrainEnv } from "./task-env";

const log = createLogger("outbox");

export interface DrainTaskEnv {
  native: NativeDrain;
  scheduled: ScheduledDrain;
  /** The drain of a task, in a headless runtime or the running app. */
  task: DrainEnv;
}

export const appDrainTaskEnv: DrainTaskEnv = { native: nativeDrain, scheduled: scheduledDrain, task: taskDrainEnv };

/** Android's drain task: one drain, then its answer to the job that started it (`data.token`, the job's id). */
export async function runDrainTask(data: unknown, env: DrainTaskEnv = appDrainTaskEnv): Promise<void> {
  const token = pathOf(data, "token");
  if (typeof token !== "string" || token === "") return;
  const outcome = await drainOwed(env.task);
  log.info("outbox drain job", { outcome });
  env.native.drainFinished(token, stillOwed(outcome));
}

/** iOS's scheduled drain: one drain; once nothing is owed, the task goes after the run has answered. */
export async function runScheduledDrain(env: DrainTaskEnv = appDrainTaskEnv): Promise<DrainOutcome> {
  const outcome = await env.scheduled.run(() => drainOwed(env.task));
  log.info("outbox scheduled drain", { outcome });
  return outcome;
}

/** At the app's entry, before any screen: a headless runtime (Android) or a background launch (iOS) needs the task. */
export function registerOutboxDrainTasks(env: DrainTaskEnv = appDrainTaskEnv): void {
  if (Platform.OS === "android") AppRegistry.registerHeadlessTask(DRAIN_TASK, () => (data: unknown) => runDrainTask(data, env));
  if (Platform.OS === "ios") {
    TaskManager.defineTask(SCHEDULED_DRAIN_TASK, async () => {
      await runScheduledDrain(env);
      // What iOS is told is only whether the task ran; whether it should run again is the registration's.
      return BackgroundTask.BackgroundTaskResult.Success;
    });
  }
}
