import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { EmailHubThread, EmailHubThreadFilters } from "../types/email-hub";

export type EmailHubThreadListPage = {
  threads: EmailHubThread[];
  counts: { total: number; unread: number };
  next_cursor?: string;
};

export const emailHubKeys = {
  accounts: (wsId: string) => ["email-hub", wsId, "accounts"] as const,
  threads: (wsId: string, accountId: string, folder: string, filters: EmailHubThreadFilters) =>
    ["email-hub", wsId, "threads", accountId, folder, filters] as const,
  thread: (wsId: string, accountId: string, threadId: string) =>
    ["email-hub", wsId, "thread", accountId, threadId] as const,
  threadSummary: (wsId: string, accountId: string, threadId: string, locale: string) =>
    ["email-hub", wsId, "thread-summary", accountId, threadId, locale] as const,
  unread: (wsId: string) => ["email-hub", wsId, "unread"] as const,
  imapLabels: (wsId: string, accountId: string) => ["email-hub", wsId, "imap-labels", accountId] as const,
};

export function threadDetailKey(wsId: string, accountId: string, threadId: string) {
  return [...emailHubKeys.thread(wsId, accountId, threadId), "detail"] as const;
}

function emailHubListRefreshKey(wsId: string, accountId: string) {
  return `${wsId}:${accountId}`;
}

const emailHubListRefreshPaused = new Set<string>();
const emailHubPendingListRefresh = new Set<string>();

/** Pause inbox list refetches while a message is open so sync cannot flash unread. */
export function setEmailHubListRefreshPaused(wsId: string, accountId: string | null, paused: boolean) {
  if (!accountId) return;
  const key = emailHubListRefreshKey(wsId, accountId);
  if (paused) {
    emailHubListRefreshPaused.add(key);
    return;
  }
  emailHubListRefreshPaused.delete(key);
}

export function flushEmailHubListRefresh(qc: QueryClient, wsId: string, accountId: string) {
  const key = emailHubListRefreshKey(wsId, accountId);
  emailHubListRefreshPaused.delete(key);
  if (!emailHubPendingListRefresh.has(key)) return;
  emailHubPendingListRefresh.delete(key);
  void qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey[0] === "email-hub" &&
      q.queryKey[1] === wsId &&
      q.queryKey[2] === "threads" &&
      q.queryKey[3] === accountId,
    refetchType: "active",
  });
}

export function invalidateEmailHubUnread(qc: QueryClient, wsId: string) {
  void qc.invalidateQueries({ queryKey: emailHubKeys.unread(wsId) });
}

export function invalidateEmailHubThreads(qc: QueryClient, wsId: string, accountId: string) {
  void qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey[0] === "email-hub" &&
      q.queryKey[1] === wsId &&
      q.queryKey[2] === "threads" &&
      q.queryKey[3] === accountId,
  });
}

export function invalidateEmailHubThreadsForAccount(qc: QueryClient, wsId: string, accountId: string) {
  const key = emailHubListRefreshKey(wsId, accountId);
  if (emailHubListRefreshPaused.has(key)) {
    emailHubPendingListRefresh.add(key);
    return;
  }
  void qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey[0] === "email-hub" &&
      q.queryKey[1] === wsId &&
      q.queryKey[2] === "threads" &&
      q.queryKey[3] === accountId,
    refetchType: "active",
  });
}

export function patchEmailHubThreadInLists(
  qc: QueryClient,
  wsId: string,
  accountId: string,
  threadId: string,
  patch: Partial<EmailHubThread>,
) {
  qc.setQueriesData<InfiniteData<EmailHubThreadListPage>>(
    { queryKey: ["email-hub", wsId, "threads", accountId], exact: false },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => {
          const hadUnread = page.threads.some((row) => row.id === threadId && !row.is_read);
          return {
            ...page,
            threads: page.threads.map((row) => (row.id === threadId ? { ...row, ...patch } : row)),
            counts:
              patch.is_read === true && hadUnread
                ? { ...page.counts, unread: Math.max(0, page.counts.unread - 1) }
                : page.counts,
          };
        }),
      };
    },
  );
}
