import type { SummaryTaskItem } from "../api/endpoints/meetings";
import type { MeetingSummaryActionItem } from "../types/meeting";

export type ActionItemAssigneeOverrides = Record<number, string | undefined>;

export type SummaryTaskFieldOverrides = Record<
  number,
  { priority?: string; due_date?: string; project_id?: string }
>;

export function buildSummaryTaskItems(
  actionItems: MeetingSummaryActionItem[],
  pickedIndices: Iterable<number>,
  assigneeOverrides?: ActionItemAssigneeOverrides,
  defaultProjectId?: string,
  fieldOverrides?: SummaryTaskFieldOverrides,
): SummaryTaskItem[] {
  const picked = new Set(pickedIndices);
  const defaultProject = defaultProjectId?.trim() || undefined;
  return actionItems
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => picked.has(index))
    .map(({ item, index }) => {
      const extra = fieldOverrides?.[index];
      const project = extra?.project_id?.trim() || defaultProject;
      const dueISO = extra?.due_date?.trim();
      const dueSpoken = !dueISO && item.due?.trim() ? item.due.trim() : undefined;
      return {
        title: item.title,
        owner: item.owner?.trim() || undefined,
        due_spoken: dueSpoken,
        assignee_id: assigneeOverrides?.[index],
        ...(project ? { project_id: project } : {}),
        ...(extra?.priority?.trim() ? { priority: extra.priority.trim() } : {}),
        ...(dueISO ? { due_date: dueISO } : {}),
      };
    });
}

// Folds case and Vietnamese diacritics like the server's normalizePersonName.
const foldName = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().trim().split(/\s+/).join(" ");

/** Best-effort client preview: match AI owner string to a workspace member display name. */
export function previewAssigneeId(
  owner: string | undefined,
  members: { user_id: string; display_name: string }[],
): string | undefined {
  const needle = owner ? foldName(owner) : "";
  if (!needle) return undefined;
  const exact = members.filter((m) => foldName(m.display_name) === needle);
  if (exact.length === 1) return exact[0]?.user_id;
  const fuzzy = members.filter((m) => {
    const name = foldName(m.display_name);
    return name.includes(needle) || needle.includes(name);
  });
  return fuzzy.length === 1 ? fuzzy[0]?.user_id : undefined;
}
