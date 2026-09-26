import { z } from "zod";
import {
  NotificationPreferenceSchema,
  NotificationSchema,
  PushConfigSchema,
  UnreadCountSchema,
  type Notification,
  type NotificationPreference,
  type PushConfig,
  type PushSubscriptionBody,
  type UnreadCount,
} from "../../types/notification";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const ListResponse = z.object({
  notifications: z.array(NotificationSchema),
  next_before: z.string().optional().default(""),
});
const PreferencesResponse = z.object({ preferences: z.array(NotificationPreferenceSchema) });
const ReadResponse = z.object({ ids: z.array(z.string()).optional().default([]) });

export interface NotificationPage {
  notifications: Notification[];
  next_before: string;
}

export interface ListNotificationsQuery {
  workspaceId?: string;
  unreadOnly?: boolean;
  before?: string;
  limit?: number;
}

const EMPTY_PAGE: NotificationPage = { notifications: [], next_before: "" };
const EMPTY_COUNT: UnreadCount = { total: 0, by_workspace: {} };

export async function listNotifications(q: ListNotificationsQuery = {}): Promise<NotificationPage> {
  const params = new URLSearchParams();
  if (q.workspaceId) params.set("workspace_id", q.workspaceId);
  if (q.unreadOnly) params.set("unread", "1");
  if (q.before) params.set("before", q.before);
  if (q.limit) params.set("limit", String(q.limit));
  const qs = params.toString();
  const raw = await request(`/api/v1/me/notifications${qs ? `?${qs}` : ""}`);
  return parseWithFallback<NotificationPage>(raw, ListResponse, EMPTY_PAGE, {
    endpoint: "GET /api/v1/me/notifications",
  });
}

export async function getUnreadCount(): Promise<UnreadCount> {
  const raw = await request("/api/v1/me/notifications/unread-count");
  return parseWithFallback<UnreadCount>(raw, UnreadCountSchema, EMPTY_COUNT, {
    endpoint: "GET /api/v1/me/notifications/unread-count",
  });
}

export async function markRead(ids: string[]): Promise<void> {
  await request("/api/v1/me/notifications/read", { method: "POST", body: { ids } });
}

/**
 * Everything open, optionally only one workspace. Resolves to the ids it
 * read, so the caller can undo it with `markUnread`; an older server that
 * does not send them resolves to [] and the undo simply has nothing to do.
 */
export async function markAllRead(workspaceId?: string): Promise<string[]> {
  const raw = await request("/api/v1/me/notifications/read", {
    method: "POST",
    body: { all: true, ...(workspaceId ? { workspace_id: workspaceId } : {}) },
  });
  return parseWithFallback<{ ids: string[] }>(raw, ReadResponse, { ids: [] }, {
    endpoint: "POST /api/v1/me/notifications/read",
  }).ids;
}

export async function markUnread(ids: string[]): Promise<void> {
  await request("/api/v1/me/notifications/unread", { method: "POST", body: { ids } });
}

export async function archive(ids: string[]): Promise<void> {
  await request("/api/v1/me/notifications/archive", { method: "POST", body: { ids } });
}

/** Puts archived rows back in the inbox: the undo of `archive`. */
export async function unarchive(ids: string[]): Promise<void> {
  await request("/api/v1/me/notifications/unarchive", { method: "POST", body: { ids } });
}

export async function getPreferences(): Promise<NotificationPreference[]> {
  const raw = await request("/api/v1/me/notification-preferences");
  return parseWithFallback<{ preferences: NotificationPreference[] }>(raw, PreferencesResponse, { preferences: [] }, {
    endpoint: "GET /api/v1/me/notification-preferences",
  }).preferences;
}

export async function setPreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
  const raw = await request("/api/v1/me/notification-preferences", { method: "PUT", body: { preferences } });
  return parseWithFallback<{ preferences: NotificationPreference[] }>(raw, PreferencesResponse, { preferences: [] }, {
    endpoint: "PUT /api/v1/me/notification-preferences",
  }).preferences;
}

/** enabled=false when the server has no VAPID keys; the client then hides push. */
export async function getPushConfig(): Promise<PushConfig> {
  const raw = await request("/api/v1/notifications/push/config");
  return parseWithFallback<PushConfig>(raw, PushConfigSchema, { enabled: false, public_key: "" }, {
    endpoint: "GET /api/v1/notifications/push/config",
  });
}

export async function subscribePush(body: PushSubscriptionBody): Promise<void> {
  await request("/api/v1/me/push-subscriptions", { method: "POST", body });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await request("/api/v1/me/push-subscriptions", { method: "DELETE", body: { endpoint } });
}
