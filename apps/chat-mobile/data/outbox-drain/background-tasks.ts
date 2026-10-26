// Imported by the app's entry (index.ts), beside the call tasks: Android's drain job may start the app's JavaScript
// without any screen, and iOS may launch it in the background for the scheduled drain; only what the entry loads
// exists then (drain-tasks.ts › registerOutboxDrainTasks).
import { registerOutboxDrainTasks } from "./drain-tasks";

registerOutboxDrainTasks();
