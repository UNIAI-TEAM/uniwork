// Imported first by the app's entry (index.ts): Android may start the app's
// JavaScript without any screen — a data-only call push, a Decline tapped
// while UniChat is closed — and only what the entry loads exists then.
import { registerCallBackgroundTasks } from "./call-wiring";

registerCallBackgroundTasks();
