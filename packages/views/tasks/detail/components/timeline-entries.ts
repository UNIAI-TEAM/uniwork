import type { AuditEvent } from "@uniwork/core/types";

export type TimelineSourceEntry<T> =
  | { kind: "activity"; at: string; event: AuditEvent }
  | { kind: "comment"; at: string; thread: T };

export type TimelineDisplayEntry<T> =
  | { kind: "activity-group"; events: AuditEvent[] }
  | { kind: "comment"; at: string; thread: T };

/** Consecutive audit rows are one scannable unit; comments remain first-class cards. */
export function groupTimelineEntries<T>(entries: TimelineSourceEntry<T>[]): TimelineDisplayEntry<T>[] {
  const grouped: TimelineDisplayEntry<T>[] = [];
  for (const entry of entries) {
    if (entry.kind === "comment") {
      grouped.push(entry);
      continue;
    }
    const previous = grouped.at(-1);
    if (previous?.kind === "activity-group") previous.events.push(entry.event);
    else grouped.push({ kind: "activity-group", events: [entry.event] });
  }
  return grouped;
}
