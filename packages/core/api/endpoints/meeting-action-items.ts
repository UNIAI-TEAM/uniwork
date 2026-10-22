import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { EvidenceListSchema } from "../../types/meeting";
import type { CreateTaskBody } from "./tasks";

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
  /** The AI's prose restating the item from the meeting; empty for a hand-added one. */
  description: z.string().nullish().catch(null),
  /** The AI's low | medium | high | urgent when the meeting signals one; empty otherwise. */
  suggested_priority: z.string().nullish().catch(null),
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
  /** What an AI item rests on; empty for the others. */
  evidence: EvidenceListSchema,
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

const CarriedOverItemSchema = z.object({
  action_item_id: z.string(),
  /** The earlier meeting that handed the task out; started_at is its actual start, else its schedule. */
  meeting: z.object({ id: z.string(), title: z.string().nullish(), started_at: z.string().nullish() }),
  /** Always open: done tasks are not carried over. */
  task: ActionItemTaskSchema,
});

export type MeetingCarriedOverItem = z.infer<typeof CarriedOverItemSchema>;

const CarriedOverResponse = z.object({
  items: z.array(z.unknown()).transform((raw): MeetingCarriedOverItem[] =>
    raw.flatMap((entry) => {
      const parsed = CarriedOverItemSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** Open tasks from the earlier ended meetings of the same project (spec meeting follow-through §6.5). */
export async function getMeetingCarriedOverItems(meetingId: string): Promise<MeetingCarriedOverItem[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/carried-over-items`);
  const parsed = parseWithFallback(raw, CarriedOverResponse, { items: [] }, { endpoint: "getMeetingCarriedOverItems" });
  return parsed.items;
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
 * Makes a pending item track a task that already exists (the open task a
 * 409 active_duplicate_task names) instead of creating one. The answer
 * carries nothing the caller reads: the refetched list shows the item converted.
 */
export async function linkMeetingActionItem(meetingId: string, itemId: string, taskId: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/action-items/${enc(itemId)}/link`, { method: "POST", body: { task_id: taskId } });
}

/**
 * One pending item the clerk turns into a task, with what the task composer
 * submitted. `assignee_id` and `due_date` are always sent: null is "nobody" /
 * "no due date", and the server never re-reads the spoken words into them.
 * `project_id` omitted takes the meeting's project; "" is no project.
 */
export interface ConvertActionItemInput
  extends Omit<CreateTaskBody, "title" | "assignee_id" | "due_date" | "project_id" | "start_at" | "due_at" | "allow_duplicate"> {
  action_item_id: string;
  title?: string;
  assignee_id: string | null;
  due_date: string | null;
  project_id?: string;
}

export interface ConvertActionItemsBody {
  items: ConvertActionItemInput[];
  /** The clerk's screen language: the tasks' descriptions label the AI's owner and due phrases in it. */
  locale?: "vi" | "en";
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
