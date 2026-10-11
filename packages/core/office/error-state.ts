// The save states the shared save-status chrome reads.
export const OFFICE_STATES = [
  "dirty",
  "ready",
  "saving",
  "saved",
  "error",
  "conflict",
  "blocked",
  "readonly",
  "incompatible",
] as const;
export type OfficeState = (typeof OFFICE_STATES)[number];

