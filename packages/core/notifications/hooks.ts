"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import * as api from "../api/endpoints/notifications";
import { isHomeSummary } from "../home/keys";
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
  /** The inbox's cursor-paged list; under `lists()`, so every mutation patches it too. */
  pages: (workspaceId: string | undefined, unreadOnly: boolean, pageSize = 50) =>
    ["notifications", "list", workspaceId ?? "", unreadOnly, pageSize, "pages"] as const,
  unreadCount: () => ["notifications", "unread-count"] as const,
  prefs: () => ["notifications", "prefs"] as const,
  pushConfig: () => ["notifications", "push-config"] as const,
};

/** `enabled: false` keeps the query cold — the bell uses it until opened. */
export function useNotifications({
  enabled = true,
  ...opts
}: { workspaceId?: string; unreadOnly?: boolean; limit?: number; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: notificationKeys.list(opts.workspaceId, !!opts.unreadOnly, opts.limit),
    queryFn: () => api.listNotifications(opts),
    enabled,
  });
}

/**
 * The inbox: newest first, `pageSize` at a time, older pages fetched on
 * demand through the server's `next_before` cursor. A short page is the end.
 */
export function useNotificationPages({
  workspaceId,
  unreadOnly = false,
  pageSize = 50,
}: { workspaceId?: string; unreadOnly?: boolean; pageSize?: number }) {
  return useInfiniteQuery({
    queryKey: notificationKeys.pages(workspaceId, unreadOnly, pageSize),
    queryFn: ({ pageParam }) =>
      api.listNotifications({ workspaceId, unreadOnly, limit: pageSize, before: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_before || undefined,
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
/** A list entry is one page (bell, home) or the inbox's pages. */
type Cached = Page | InfiniteData<Page, string>;

function mapRows(data: Cached, fn: (rows: Notification[]) => Notification[]): Cached {
  if ("pages" in data) return { ...data, pages: data.pages.map((p) => ({ ...p, notifications: fn(p.notifications) })) };
  return { ...data, notifications: fn(data.notifications) };
}

function rowsOf(data: Cached | undefined): Notification[] {
  if (!data) return [];
  return "pages" in data ? data.pages.flatMap((p) => p.notifications) : data.notifications;
}

/** Rewrite the rows of every cached list; returns the snapshots for rollback. */
function rewriteLists(qc: ReturnType<typeof useQueryClient>, fn: (rows: Notification[]) => Notification[]) {
  const snapshots = qc.getQueriesData<Cached>({ queryKey: notificationKeys.lists() });
  for (const [key, data] of snapshots) {
    if (!data) continue;
    qc.setQueryData<Cached>(key, mapRows(data, fn));
  }
  return snapshots;
}

/** Patch every cached row in place; returns the snapshots for rollback. */
function patchLists(qc: ReturnType<typeof useQueryClient>, fn: (n: Notification) => Notification) {
  return rewriteLists(qc, (rows) => rows.map(fn));
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

/**
 * After any read, unread or archive: the lists and the badge refetch, and so
 * does every home summary, which carries its own unread rows and count.
 */
function settle(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ predicate: isHomeSummary });
  return qc.invalidateQueries({ queryKey: notificationKeys.all });
}

function cachedRows(qc: ReturnType<typeof useQueryClient>, ids: string[]): Notification[] {
  const seen = new Map<string, Notification>();
  for (const [, data] of qc.getQueriesData<Cached>({ queryKey: notificationKeys.lists() })) {
    for (const n of rowsOf(data)) if (ids.includes(n.id)) seen.set(n.id, n);
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
    onSettled: () => settle(qc),
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
    onSettled: () => settle(qc),
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
      const lists = rewriteLists(qc, (rows) => rows.filter((n) => !ids.includes(n.id)));
      const count = adjustUnread(qc, () => -1, unread);
      return { lists, count };
    },
    onError: (_e, _ids, ctx) => {
      for (const [key, page] of ctx?.lists ?? []) qc.setQueryData(key, page);
      if (ctx?.count) qc.setQueryData(notificationKeys.unreadCount(), ctx.count);
    },
    onSettled: () => settle(qc),
  });
}

/**
 * The undo of archive. Not optimistic: the archived rows left every cache,
 * so there is nothing local to put back; the lists refetch and the rows
 * return in their place.
 */
export function useUnarchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.unarchive(ids),
    onSettled: () => settle(qc),
  });
}

export function useNotificationPreferences() {
  return useQuery({ queryKey: notificationKeys.prefs(), queryFn: api.getPreferences });
}

export function useSetNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: notificationKeys.prefs(),
    mutationFn: (prefs: NotificationPreference[]) => api.setPreferences(prefs),
    // Each answer is a full snapshot and overlapping writes (one per row) can
    // answer out of order. While another write is pending, only mark the entry
    // stale; the last write to settle refetches if anything overlapped it.
    onSuccess: (prefs) => {
      const key = notificationKeys.prefs();
      if (qc.isMutating({ mutationKey: key }) > 1) {
        void qc.invalidateQueries({ queryKey: key, refetchType: "none" });
      } else if (qc.getQueryState(key)?.isInvalidated) {
        void qc.invalidateQueries({ queryKey: key });
      } else {
        qc.setQueryData(key, prefs);
      }
    },
  });
}

export function usePushConfig() {
  return useQuery({ queryKey: notificationKeys.pushConfig(), queryFn: api.getPushConfig, staleTime: Infinity });
}
