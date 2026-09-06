import { z } from "zod";

/** Mirrors server/internal/notification/kinds.go, in display order. */
export const NOTIFICATION_KINDS = [
  "task_assigned",
  "task_status_changed",
  "task_commented",
  "mentioned",
  "meeting_invited",
  "meeting_starting",
  "member_added",
  "role_changed",
  "audit_export_ready",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Lenient on the wire: kind and resource_type stay strings, the types narrow them. */
export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  workspace_id: z.string().optional().default(""),
  organization_id: z.string().optional().default(""),
  resource_type: z.string(),
  resource_id: z.string(),
  resource_deleted: z.boolean().optional().default(false),
  actor_kind: z.string().optional().default("system"),
  actor_id: z.string().optional().default(""),
  title_key: z.string(),
  params: z.record(z.string(), z.string()).optional().default({}),
  count: z.number().optional().default(1),
  read_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});
export type Notification = Omit<z.infer<typeof NotificationSchema>, "kind"> & { kind: NotificationKind | (string & {}) };

export const UnreadCountSchema = z.object({
  total: z.number(),
  by_workspace: z.record(z.string(), z.number()).optional().default({}),
});
export type UnreadCount = z.infer<typeof UnreadCountSchema>;

export const NotificationPreferenceSchema = z.object({
  kind: z.string(),
  in_app: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

export const PushConfigSchema = z.object({
  enabled: z.boolean(),
  public_key: z.string().optional().default(""),
});
export type PushConfig = z.infer<typeof PushConfigSchema>;

/** What the browser hands back from PushManager.subscribe(), as the API wants it. */
export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
