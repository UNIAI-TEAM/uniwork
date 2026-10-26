import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";

/**
 * Pure grouping of a meeting's action items for the close-out board
 * (brief §2 "Owner groups"): one group per owner, in the order the meeting
 * first named them, pending rows before the converted ones.
 */

/** Past this many owners the board goes flat (brief: "More than 5 owners"). */
export const FLAT_AFTER_OWNERS = 5;
/** Past this many pending rows a group folds the rest behind "Xem thêm n". */
export const GROUP_ROWS = 5;

export type OwnerGroup = {
  /** "" for the items nobody was named for. */
  ownerId: string;
  pending: MeetingActionItem[];
  converted: MeetingActionItem[];
  /** Converted items whose task is done. */
  done: number;
};

/** Whose an item is: the suggestion while pending, the task's assignee once converted. */
export function ownerOf(item: MeetingActionItem): string {
  if (item.status === "CONVERTED") return item.task?.assignee_id ?? "";
  return item.suggested_assignee_id ?? "";
}

/** Pending and converted items by owner, in first-mention order; the unnamed group last. */
export function ownerGroups(items: readonly MeetingActionItem[]): OwnerGroup[] {
  const byOwner = new Map<string, OwnerGroup>();
  for (const item of items) {
    if (item.status !== "PENDING" && item.status !== "CONVERTED") continue;
    const ownerId = ownerOf(item);
    let group = byOwner.get(ownerId);
    if (!group) {
      group = { ownerId, pending: [], converted: [], done: 0 };
      byOwner.set(ownerId, group);
    }
    if (item.status === "PENDING") group.pending.push(item);
    else {
      group.converted.push(item);
      if (item.task?.done) group.done += 1;
    }
  }
  const groups = [...byOwner.values()];
  return [...groups.filter((g) => g.ownerId !== ""), ...groups.filter((g) => g.ownerId === "")];
}

/** The earliest YYYY-MM-DD among `dates`, or null when none is set. */
export function earliestDue(dates: readonly (string | null | undefined)[]): string | null {
  let first: string | null = null;
  for (const d of dates) if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && (first === null || d < first)) first = d;
  return first;
}

/** How many rows each owner receives, in first-appearance order ("" = nobody). */
export function recipients(ownerIds: readonly string[]): { ownerId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of ownerIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([ownerId, count]) => ({ ownerId, count }));
}
