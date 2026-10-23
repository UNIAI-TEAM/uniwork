import { z } from "zod";
import { MeetingSchema } from "./meeting";
import { NotificationSchema, type Notification } from "./notification";
import { TaskSchema, type Task } from "./task";

const count = z.number().int().nonnegative().catch(0);

const HomeCountsSchema = z
  .object({ open: count, overdue: count, due_today: count, meetings_today: count, unread: count })
  .catch({ open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 });
export type HomeCounts = z.infer<typeof HomeCountsSchema>;

/**
 * GET /workspaces/{ws}/home. Each section degrades on its own: a drifted list
 * becomes empty (the endpoint also names it in `partial`), a drifted count
 * becomes 0. Only a response without `today` is unusable.
 */
export const HomeSummarySchema = z.object({
  today: z.string(),
  timezone: z.string().catch(""),
  counts: HomeCountsSchema,
  my_work: z.array(TaskSchema).catch([]),
  upcoming_meetings: z.array(MeetingSchema).catch([]),
  inbox: z.array(NotificationSchema).catch([]),
  partial: z.array(z.string()).catch([]),
  generated_at: z.string().catch(""),
});
export type HomeSummary = Omit<z.infer<typeof HomeSummarySchema>, "my_work" | "inbox"> & {
  my_work: Task[];
  inbox: Notification[];
};

/** Home sources the server can report as failed; the UI labels each one. */
export type HomeSource = "tasks" | "meetings" | "notifications";

export const HomePreferenceSchema = z.object({
  prefs: z.record(z.string(), z.unknown()).catch({}),
  updated_at: z.string().catch(""),
});
export type HomePreference = z.infer<typeof HomePreferenceSchema>;
