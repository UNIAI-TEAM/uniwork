import type { SummaryTaskItem } from "../api/endpoints/meetings";
import type { MeetingSummaryActionItem } from "../types/meeting";

export type ActionItemAssigneeOverrides = Record<number, string | undefined>;

export function buildSummaryTaskItems(
  actionItems: MeetingSummaryActionItem[],
  pickedIndices: Iterable<number>,
  assigneeOverrides?: ActionItemAssigneeOverrides,
): SummaryTaskItem[] {
  const picked = new Set(pickedIndices);
  return actionItems
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => picked.has(index))
    .map(({ item, index }) => ({
      title: item.title,
      owner: item.owner?.trim() || undefined,
      due_spoken: item.due?.trim() || undefined,
      assignee_id: assigneeOverrides?.[index],
    }));
}

/** Best-effort client preview: match AI owner string to a workspace member display name. */
export function previewAssigneeId(
  owner: string | undefined,
  members: { user_id: string; display_name: string }[],
): string | undefined {
  const needle = owner?.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = members.filter((m) => m.display_name.trim().toLowerCase() === needle);
  if (exact.length === 1) return exact[0]?.user_id;
  const fuzzy = members.filter((m) => {
    const name = m.display_name.trim().toLowerCase();
    return name.includes(needle) || needle.includes(name);
  });
  return fuzzy.length === 1 ? fuzzy[0]?.user_id : undefined;
}
