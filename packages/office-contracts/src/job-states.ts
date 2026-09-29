import { z } from "zod";

// Job lifecycle states on the wire (engine-contract.md §6.1). The last five
// are terminal: no transition out of a terminal state is legal, and only
// `completed` may proceed to a version commit.
export const jobStates = [
  "accepted",
  "running",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "crashed",
] as const;
export const jobStateSchema = z.enum(jobStates);
export type JobState = (typeof jobStates)[number];

export const terminalJobStates = ["completed", "failed", "timed_out", "cancelled", "crashed"] as const;
export type TerminalJobState = (typeof terminalJobStates)[number];
export function isTerminalJobState(state: JobState): state is TerminalJobState {
  return (terminalJobStates as readonly string[]).includes(state);
}
