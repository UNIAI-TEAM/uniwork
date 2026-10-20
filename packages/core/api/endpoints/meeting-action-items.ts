import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/** PENDING, CONVERTED or DISMISSED; a switch over it carries a default for a state a newer server adds. */
export type MeetingActionItemStatus = "PENDING" | "CONVERTED" | "DISMISSED" | (string & {});

const ActionItemTaskSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  status: z.string().nullish(),
  done: z.boolean().nullish(),
  overdue: z.boolean().nullish(),
  assignee_id: z.string().nullish(),
  due_date: z.string().nullish(),
});

const ActionItemSchema = z.object({
  id: z.string(),
  /** AI (a summary proposed it), MANUAL (a clerk typed it), LIVE (the AI scribe, during the meeting). */
  source: z.string().nullish(),
  position: z.number().nullish(),
  title: z.string(),
  owner_text: z.string().nullish(),
  due_text: z.string().nullish(),
  /** Pending items only: the one member the owner phrase names. */
  suggested_assignee_id: z.string().nullish(),
  /** Pending items only: the due phrase read against the meeting's day (YYYY-MM-DD). */
  suggested_due_date: z.string().nullish(),
  status: z.string(),
  dismiss_reason: z.string().nullish(),
  dismissed_by: z.string().nullish(),
  dismissed_at: z.string().nullish(),
  /** Converted items only: the live task. */
  task: ActionItemTaskSchema.nullish(),
  summary_id: z.string().nullish(),
  created_at: z.string().nullish(),
});

export type MeetingActionItem = Omit<z.infer<typeof ActionItemSchema>, "status"> & {
  status: MeetingActionItemStatus;
};

const CountsSchema = z.object({
  pending: z.number().catch(0),
  converted: z.number().catch(0),
  dismissed: z.number().catch(0),
  tasks_done: z.number().catch(0),
  tasks_overdue: z.number().catch(0),
});

export type MeetingActionItemCounts = z.infer<typeof CountsSchema>;

export interface MeetingActionItems {
  items: MeetingActionItem[];
  counts: MeetingActionItemCounts;
}

const NO_COUNTS: MeetingActionItemCounts = { pending: 0, converted: 0, dismissed: 0, tasks_done: 0, tasks_overdue: 0 };

/** Items parsed one by one: an entry that does not parse is dropped, not the list. */
const ItemsSchema = z.array(z.unknown()).transform((raw): MeetingActionItem[] =>
  raw.flatMap((entry) => {
    const parsed = ActionItemSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }),
);

const ListResponse = z.object({ items: ItemsSchema, counts: CountsSchema.catch(NO_COUNTS) });

export async function getMeetingActionItems(meetingId: string): Promise<MeetingActionItems> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/action-items`);
  return parseWithFallback(raw, ListResponse, { items: [], counts: NO_COUNTS }, { endpoint: "getMeetingActionItems" });
}

const AddResponse = z.object({ item: ActionItemSchema });

export interface AddMeetingActionItemBody {
  title: string;
  owner_text?: string;
  due_text?: string;
}

/** Null when the answer cannot be read: the item may exist, the refetched list shows it. */
export async function addMeetingActionItem(meetingId: string, body: AddMeetingActionItemBody): Promise<MeetingActionItem | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/action-items`, { method: "POST", body });
  const parsed = parseWithFallback<{ item: MeetingActionItem } | null>(raw, AddResponse, null, { endpoint: "addMeetingActionItem" });
  return parsed?.item ?? null;
}

export async function dismissMeetingActionItem(meetingId: string, itemId: string, reason: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/action-items/${enc(itemId)}/dismiss`, {
    method: "POST",
    body: reason ? { reason } : {},
  });
}

export async function restoreMeetingActionItem(meetingId: string, itemId: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/action-items/${enc(itemId)}/restore`, { method: "POST" });
}

/**
 * One pending item the clerk turns into a task, with the values the clerk
 * confirmed. `assignee_id` and `due_date` are always sent: null is "nobody" /
 * "no due date", and the server never re-reads the spoken words into them.
 * `project_id` omitted takes the meeting's project; "" is no project.
 */
export interface ConvertActionItemInput {
  action_item_id: string;
  title?: string;
  description?: string;
  assignee_id: string | null;
  due_date: string | null;
  project_id?: string;
  priority?: string;
}

export interface ConvertActionItemsBody {
  items: ConvertActionItemInput[];
}

const ConvertResponse = z.object({
  links: z.array(z.object({ action_item_id: z.string(), task_id: z.string() })),
});

export type ConvertActionItemsResult = z.infer<typeof ConvertResponse>;

/**
 * Null when the answer cannot be read: the tasks may well exist, so the
 * caller must not report a count it does not know (the refetched list shows
 * which items became tasks).
 */
export async function convertMeetingActionItems(
  meetingId: string,
  body: ConvertActionItemsBody,
): Promise<ConvertActionItemsResult | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/action-items/convert`, { method: "POST", body });
  return parseWithFallback<ConvertActionItemsResult | null>(raw, ConvertResponse, null, {
    endpoint: "convertMeetingActionItems",
  });
}
