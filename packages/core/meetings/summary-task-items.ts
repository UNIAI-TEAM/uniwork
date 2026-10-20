import type { ConvertActionItemsBody, MeetingActionItem } from "../api/endpoints/meeting-action-items";
import type { TaskPriority } from "../types/task";

// ---- Meeting action items → tasks -------------------------------------------------

/**
 * What the clerk confirmed for one action item. null is a choice, not a gap:
 * "nobody" and "no due date" reach the server as null and stay that way.
 * A blank title keeps the item's own.
 */
export interface SummaryItemDraft {
  assigneeId: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  title?: string;
}

/**
 * The draft a clerk starts from: the server's suggestion for the assignee and
 * the due date (what the list showed before anything was edited), no priority.
 */
export function summaryItemDraft(item: MeetingActionItem): SummaryItemDraft {
  return {
    assigneeId: item.suggested_assignee_id || null,
    dueDate: item.suggested_due_date || null,
    priority: "none",
  };
}

/**
 * The POST …/action-items/convert body for the picked items still pending.
 * Every item carries assignee_id and due_date (null = none); the project is
 * always explicit, "" when the clerk chose none, so a project the meeting
 * points at but the clerk cleared is not applied by the server's default.
 * Null when nothing is left to convert.
 */
export function buildConvertActionItemsBody(
  items: readonly MeetingActionItem[],
  picked: ReadonlySet<string>,
  drafts: Readonly<Record<string, SummaryItemDraft | undefined>>,
  projectId: string | undefined,
): ConvertActionItemsBody | null {
  const project = projectId?.trim() ?? "";
  const out = items
    .filter((item) => picked.has(item.id) && item.status === "PENDING")
    .map((item) => {
      const draft = drafts[item.id] ?? summaryItemDraft(item);
      const title = draft.title?.trim();
      return {
        action_item_id: item.id,
        ...(title && title !== item.title ? { title } : {}),
        assignee_id: draft.assigneeId?.trim() || null,
        due_date: draft.dueDate?.trim() || null,
        project_id: project,
        ...(draft.priority !== "none" ? { priority: draft.priority } : {}),
      };
    });
  return out.length > 0 ? { items: out } : null;
}

// ---- Email Hub summary → tasks ------------------------------------------------

/** One Email Hub action item to create, in the Email Hub request's shape. */
export interface AiSummaryTaskItem {
  title: string;
  owner?: string;
  due_spoken?: string;
  assignee_id?: string;
  project_id?: string;
  priority?: string;
  due_date?: string;
}

export type SummaryTaskFieldOverrides = Record<
  number,
  { priority?: string; due_date?: string; project_id?: string }
>;

/** The Email Hub create-tasks items for the picked action items (meetings use buildMeetingSummaryTasksBody). */
export function buildSummaryTaskItems(
  actionItems: readonly { title: string; owner?: string; due?: string }[],
  pickedIndices: Iterable<number>,
  assigneeOverrides?: Record<number, string | undefined>,
  defaultProjectId?: string,
  fieldOverrides?: SummaryTaskFieldOverrides,
): AiSummaryTaskItem[] {
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

// ---- Owner name → member preview (Email Hub) -----------------------------------

// Forms of address spoken before a name, compared after folding ("chị" is
// "chi"). The list and the rules below are the server's resolver's
// (server/internal/service/meeting_task_resolve.go), so the Email Hub preview
// and a meeting summary's suggested_assignee_id agree on the same names.
const HONORIFICS = new Set([
  "anh", "chi", "em", "co", "chu", "bac", "ong", "ba", "ban", "sep", "thay", "di", "mr", "ms", "mrs", "miss",
]);

/** Lowercase, Vietnamese diacritics removed (đ → d), punctuation dropped, spaces collapsed. */
function foldName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** The owner as spoken and, when it starts with honorifics, without them. A bare honorific stays: "Anh" is also a name. */
function ownerKeys(owner: string): string[] {
  const key = foldName(owner);
  if (!key) return [];
  const tokens = key.split(" ");
  let i = 0;
  while (i < tokens.length - 1 && HONORIFICS.has(tokens[i]!)) i++;
  return i === 0 ? [key] : [key, tokens.slice(i).join(" ")];
}

function endsWithTokens(name: string[], suffix: string[]): boolean {
  if (suffix.length === 0 || suffix.length > name.length) return false;
  const offset = name.length - suffix.length;
  return suffix.every((tok, i) => name[offset + i] === tok);
}

/**
 * The one member an AI owner name points at, or undefined when nobody or more
 * than one person fits. A name matches a member whose whole display name it
 * equals, or failing that whose trailing words it is (Vietnamese names end
 * with the given name: "An" and "Văn An" match "Nguyễn Văn An", "An" never
 * matches "Thanh", "Lan" never matches "Lan Anh").
 */
export function previewAssigneeId(
  owner: string | undefined,
  members: readonly { user_id: string; display_name: string }[],
): string | undefined {
  const folded = members.map((m) => ({ id: m.user_id, name: foldName(m.display_name) })).filter((m) => m.name);
  const single = (ids: string[]) => {
    const unique = [...new Set(ids)];
    return unique.length === 1 ? unique[0] : undefined;
  };
  for (const key of ownerKeys(owner ?? "")) {
    const exact = folded.filter((m) => m.name === key).map((m) => m.id);
    if (exact.length > 0) return single(exact);
    const tokens = key.split(" ");
    const suffix = folded.filter((m) => endsWithTokens(m.name.split(" "), tokens)).map((m) => m.id);
    if (suffix.length > 0) return single(suffix);
  }
  return undefined;
}
