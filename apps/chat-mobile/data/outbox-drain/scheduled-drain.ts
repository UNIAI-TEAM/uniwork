// iOS's scheduled drain (expo-background-task: a BGProcessingTask that needs a network, 15 minutes at the soonest),
// kept while something is owed (background-send.ts says when).
//
// A run never unregisters its own task. expo-task-manager completes the BGProcessingTask (setTaskCompleted) only
// once the executor's answer finds the task still registered (EXTaskService › notifyTaskWithName:didFinishWithResponse:
// looks it up by name); unregistered meanwhile, the answer matches nothing, the task lasts until iOS expires it, and
// iOS schedules the app less for it. So a run that finds nothing owed only notes the drop, and the drop happens later:
// back on screen (settle), or as the app next leaves it (keepSendingOffScreen decides again). A drop asked for while
// a run is under way (a notification action off screen) waits the same way.
import * as BackgroundTask from "expo-background-task";
import { SCHEDULED_DRAIN_TASK, stillOwed, type DrainOutcome } from "./drain";

/** iOS's scheduled drain, in minutes: expo-background-task's floor. */
const SCHEDULED_INTERVAL_MINUTES = 15;

export interface ScheduledDrain {
  keep: () => Promise<void>;
  /** The task goes; during a run of it, once the run has answered (settle). */
  drop: () => Promise<void>;
  /** One run of the task: the drain, and whether the task should go once the run has answered. */
  run: (drain: () => Promise<DrainOutcome>) => Promise<DrainOutcome>;
  /** Back on screen: the drop a run left for later, when no run is under way. */
  settle: () => Promise<void>;
}

interface TaskRegistration {
  register: () => Promise<void>;
  unregister: () => Promise<void>;
}

export function createScheduledDrain(registration: TaskRegistration): ScheduledDrain {
  let runs = 0;
  let dropOwed = false;
  return {
    keep() {
      dropOwed = false;
      return registration.register();
    },
    async drop() {
      if (runs > 0) {
        dropOwed = true;
        return;
      }
      dropOwed = false;
      await registration.unregister();
    },
    async run(drain) {
      runs += 1;
      try {
        const outcome = await drain();
        // What this run found is the latest word on the registration, a drop asked for meanwhile included.
        dropOwed = !stillOwed(outcome);
        return outcome;
      } finally {
        runs -= 1;
      }
    },
    async settle() {
      if (!dropOwed || runs > 0) return;
      dropOwed = false;
      await registration.unregister();
    },
  };
}

export const scheduledDrain: ScheduledDrain = createScheduledDrain({
  register: () => BackgroundTask.registerTaskAsync(SCHEDULED_DRAIN_TASK, { minimumInterval: SCHEDULED_INTERVAL_MINUTES }),
  unregister: () => BackgroundTask.unregisterTaskAsync(SCHEDULED_DRAIN_TASK),
});
