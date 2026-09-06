"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/notifications";
import type { Notification, NotificationPreference, UnreadCount } from "../types/notification";

export type { ListNotificationsQuery, NotificationPage } from "../api/endpoints/notifications";

/**
 * Query keys. Notifications are the person's, not the workspace's: the list
 * key carries the workspace filter, the unread count is one account-level
 * entry shared by every workspace (the switcher reads it for other
 * workspaces' dots).
 */
export const notificationKeys = {
  all: ["notifications"] as const,
  lists: () => ["notifications", "list"] as const,
  list: (workspaceId: string | undefined, unreadOnly: boolean, limit = 50) =>
    ["notifications", "list", workspaceId ?? "", unreadOnly, limit] as const,
  unreadCount: () => ["notifications", "unread-count"] as const,
  prefs: () => ["notifications", "prefs"] as const,
  pushConfig: () => ["notifications", "push-config"] as const,
};

export function useNotifications(opts: { workspaceId?: string; unreadOnly?: boolean; limit?: number } = {}) {
  return useQuery({
    queryKey: notificationKeys.list(opts.workspaceId, !!opts.unreadOnly, opts.limit),
    queryFn: () => api.listNotifications(opts),
  });
}

/** The badge. 30 s stale; realtime invalidates on notification.created. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: api.getUnreadCount,
    staleTime: 30_000,
  });
}

type Page = api.NotificationPage;

/** Patch every cached list page in place; returns the snapshots for rollback. */
function patchLists(qc: ReturnType<typeof useQueryClient>, fn: (n: Notification) => Notification) {
  const snapshots = qc.getQueriesData<Page>({ queryKey: notificationKeys.lists() });
  for (const [key, page] of snapshots) {
    if (!page) continue;
    qc.setQueryData<Page>(key, { ...page, notifications: page.notifications.map(fn) });
  }
  return snapshots;
}

function adjustUnread(qc: ReturnType<typeof useQueryClient>, delta: (n: Notification) => number, rows: Notification[]) {
  const prev = qc.getQueryData<UnreadCount>(notificationKeys.unreadCount());
  if (!prev) return prev;
  const next: UnreadCount = { total: prev.total, by_workspace: { ...prev.by_workspace } };
  for (const n of rows) {
    const d = delta(n);
    next.total = Math.max(0, next.total + d);
    if (n.workspace_id) next.by_workspace[n.workspace_id] = Math.max(0, (next.by_workspace[n.workspace_id] ?? 0) + d);
  }
  qc.setQueryData(notificationKeys.unreadCount(), next);
  return prev;
}

function cachedRows(qc: ReturnType<typeof useQueryClient>, ids: string[]): Notification[] {
  const seen = new Map<string, Notification>();
  for (const [, page] of qc.getQueriesData<Page>({ queryKey: notificationKeys.lists() })) {
    for (const n of page?.notifications ?? []) if (ids.includes(n.id)) seen.set(n.id, n);
  }
  return [...seen.values()];
}

/**
 * Optimistic on purpose: the outcome is locally predictable, the user stays
 * on the inbox, failure is rare, and rollback is a cache restore — the four
 * conditions CLAUDE.md sets. The badge is patched with the same delta so it
 * never lags the row it belongs to.
 */
function useReadMutation(read: boolean) {
  const qc = useQueryClient();
  const stamp = () => new Date().toISOString();
  return useMutation({
    mutationFn: (ids: string[]) => (read ? api.markRead(ids) : api.markUnread(ids)),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: notificationKeys.all });
      const affected = cachedRows(qc, ids).filter((n) => !!n.read_at !== read);
      const lists = patchLists(qc, (n) =>
        ids.includes(n.id) ? { ...n, read_at: read ? (n.read_at ?? stamp()) : undefined } : n,
      );
      const count = adjustUnread(qc, () => (read ? -1 : 1), affected);
      return { lists, count };
    },
    onError: (_e, _ids, ctx) => {
      for (const [key, page] of ctx?.lists ?? []) qc.setQueryData(key, page);
      if (ctx?.count) qc.setQueryData(notificationKeys.unreadCount(), ctx.count);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkRead() {
  return useReadMutation(true);
}

export function useMarkUnread() {
  return useReadMutation(false);
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId?: string) => api.markAllRead(workspaceId),
    onMutate: async (workspaceId) => {
      await qc.cancelQueries({ queryKey: notificationKeys.all });
      const stamp = new Date().toISOString();
      const lists = patchLists(qc, (n) =>
        !n.read_at && (!workspaceId || n.workspace_id === workspaceId) ? { ...n, read_at: stamp } : n,
      );
      const prev = qc.getQueryData<UnreadCount>(notificationKeys.unreadCount());
      if (prev) {
        const next: UnreadCount = workspaceId
          ? {
              total: Math.max(0, prev.total - (prev.by_workspace[workspaceId] ?? 0)),
              by_workspace: { ...prev.by_workspace, [workspaceId]: 0 },
            }
          : { total: 0, by_workspace: {} };
        qc.setQueryData(notificationKeys.unreadCount(), next);
      }
      return { lists, count: prev };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, page] of ctx?.lists ?? []) qc.setQueryData(key, page);
      if (ctx?.count) qc.setQueryData(notificationKeys.unreadCount(), ctx.count);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/** Archive hides the row; an unread one also leaves the badge. */
export function useArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.archive(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: notificationKeys.all });
      const unread = cachedRows(qc, ids).filter((n) => !n.read_at);
      const lists = qc.getQueriesData<Page>({ queryKey: notificationKeys.lists() });
      for (const [key, page] of lists) {
        if (!page) continue;
        qc.setQueryData<Page>(key, { ...page, notifications: page.notifications.filter((n) => !ids.includes(n.id)) });
      }
      const count = adjustUnread(qc, () => -1, unread);
      return { lists, count };
    },
    onError: (_e, _ids, ctx) => {
      for (const [key, page] of ctx?.lists ?? []) qc.setQueryData(key, page);
      if (ctx?.count) qc.setQueryData(notificationKeys.unreadCount(), ctx.count);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useNotificationPreferences() {
  return useQuery({ queryKey: notificationKeys.prefs(), queryFn: api.getPreferences });
}

export function useSetNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPreference[]) => api.setPreferences(prefs),
    onSuccess: (prefs) => qc.setQueryData(notificationKeys.prefs(), prefs),
  });
}

export function usePushConfig() {
  return useQuery({ queryKey: notificationKeys.pushConfig(), queryFn: api.getPushConfig, staleTime: Infinity });
}
