import { useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { EmailHubThread, EmailHubThreadFilters } from "../types/email-hub";

type EmailHubThreadListPage = {
  threads: EmailHubThread[];
  counts: { total: number; unread: number };
  next_cursor?: string;
};
import * as api from "../api/endpoints/email-hub";

export const emailHubKeys = {
  accounts: (wsId: string) => ["email-hub", wsId, "accounts"] as const,
  threads: (wsId: string, accountId: string, folder: string, filters: EmailHubThreadFilters) =>
    ["email-hub", wsId, "threads", accountId, folder, filters] as const,
  thread: (wsId: string, accountId: string, threadId: string) =>
    ["email-hub", wsId, "thread", accountId, threadId] as const,
};

function threadDetailKey(wsId: string, accountId: string, threadId: string) {
  return [...emailHubKeys.thread(wsId, accountId, threadId), "detail"] as const;
}

export function useEmailHubAccounts(wsId: string) {
  return useQuery({
    queryKey: emailHubKeys.accounts(wsId),
    queryFn: () => api.listEmailHubAccounts(wsId),
    staleTime: 30_000,
  });
}

export function useEmailHubThreads(
  wsId: string,
  accountId: string | null,
  folder = "INBOX",
  filters: EmailHubThreadFilters = {},
) {
  return useInfiniteQuery({
    queryKey: emailHubKeys.threads(wsId, accountId ?? "", folder, filters),
    queryFn: ({ pageParam }) =>
      api.listEmailHubThreads(wsId, accountId!, folder, filters, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!accountId,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
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

function emailHubBodyIsPlaceholder(
  thread: { body_html?: string; body_text?: string; snippet?: string } | null | undefined,
) {
  if (!thread) return false;
  if (thread.body_html?.trim()) return false;
  const text = thread.body_text?.trim() ?? "";
  const snippet = thread.snippet?.trim() ?? "";
  return !!text && !!snippet && text === snippet;
}

export function emailHubHasReadableBody(
  thread: { body_html?: string; body_text?: string; snippet?: string } | null | undefined,
) {
  if (!thread) return false;
  if (thread.body_html?.trim()) return true;
  const text = thread.body_text?.trim() ?? "";
  if (!text) return false;
  return !emailHubBodyIsPlaceholder(thread);
}

/** One request on open (meta + body + mark read) for minimum latency. */
export function useEmailHubThread(
  wsId: string,
  accountId: string | null,
  threadId: string | null,
  listHint?: EmailHubThread | null,
) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: threadDetailKey(wsId, accountId ?? "", threadId ?? ""),
    queryFn: ({ signal }): Promise<EmailHubThread | null> =>
      api.getEmailHubThread(wsId, accountId!, threadId!, true, true, signal),
    enabled: !!accountId && !!threadId,
    placeholderData: listHint?.id === threadId ? listHint : undefined,
    staleTime: 30_000,
    retry: false,
  });
  const data = detail.data?.id === threadId ? detail.data : undefined;
  useEffect(() => {
    if (!accountId || !threadId || !data?.is_read) return;
    patchEmailHubThreadInLists(qc, wsId, accountId, threadId, { is_read: true });
  }, [accountId, threadId, data?.is_read, qc, wsId]);
  const isBodyLoading =
    !!threadId &&
    !emailHubHasReadableBody(data) &&
    (detail.isFetching || detail.isLoading);
  const isBodyLoadFailed =
    !!threadId &&
    !!data &&
    !isBodyLoading &&
    !emailHubHasReadableBody(data);

  return {
    ...detail,
    data,
    isLoading: detail.isLoading && !data,
    isBodyLoading,
    isBodyLoadFailed,
    isError: detail.isError,
    error: detail.error,
  };
}

export function prefetchEmailHubThread(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string,
  accountId: string,
  threadId: string,
  fetchBody = true,
) {
  void qc.prefetchQuery({
    queryKey: threadDetailKey(wsId, accountId, threadId),
    queryFn: ({ signal }) =>
      api.getEmailHubThread(wsId, accountId, threadId, fetchBody, false, signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function useConnectEmailHubAccount(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; appPassword: string }) =>
      api.connectEmailHubAccount(wsId, input.email, input.appPassword),
    onSuccess: (acc) => {
      void qc.invalidateQueries({ queryKey: emailHubKeys.accounts(wsId) });
      if (acc?.id) {
        void api.syncEmailHub(wsId, acc.id, undefined, true).then(
          () => invalidateEmailHubThreads(qc, wsId, acc.id),
          () => {
            /* initial sync is best-effort; connect already succeeded */
          },
        );
      }
    },
  });
}

export function useDisconnectEmailHubAccount(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.disconnectEmailHubAccount(wsId, accountId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: emailHubKeys.accounts(wsId) });
    },
  });
}

function invalidateEmailHubThreads(qc: ReturnType<typeof useQueryClient>, wsId: string, accountId: string) {
  void qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey[0] === "email-hub" &&
      q.queryKey[1] === wsId &&
      q.queryKey[2] === "threads" &&
      q.queryKey[3] === accountId,
  });
}

export function useSyncEmailHub(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; folder?: string; force?: boolean }) =>
      api.syncEmailHub(wsId, input.accountId, input.folder, input.force, false),
    onSuccess: (result, input) => {
      if (result?.synced) {
        invalidateEmailHubThreadsForAccount(qc, wsId, input.accountId);
        void qc.invalidateQueries({ queryKey: emailHubKeys.accounts(wsId) });
      }
    },
  });
}

export function useSendEmailHub(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.SendEmailHubInput) => api.sendEmailHub(wsId, input),
    onSuccess: (thread, input) => {
      if (!thread) return;
      qc.setQueryData(threadDetailKey(wsId, input.accountId, thread.id), thread);
      invalidateEmailHubThreads(qc, wsId, input.accountId);
    },
  });
}

export function invalidateEmailHubThreadsForAccount(qc: QueryClient, wsId: string, accountId: string) {
  void qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey[0] === "email-hub" &&
      q.queryKey[1] === wsId &&
      q.queryKey[2] === "threads" &&
      q.queryKey[3] === accountId,
    refetchType: "active",
  });
}

const emailHubLivePollMs = 45_000;
const emailHubSafetyPollMs = 5 * 60_000;

/**
 * Server-side INBOX watch while Email Hub is open. Changes arrive via WebSocket;
 * heartbeat re-subscribes after reconnect. Rare poll when not reading a message.
 */
export function useEmailHubLiveSync(
  wsId: string,
  accountId: string | null,
  enabled = true,
  readingEmail = false,
) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || !accountId) return;
    let cancelled = false;

    const refetchIfSynced = (synced: boolean) => {
      if (synced) invalidateEmailHubThreadsForAccount(qc, wsId, accountId);
    };

    const subscribe = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        await api.subscribeEmailHubInboxWatch(wsId, accountId);
      } catch {
        /* retry on next heartbeat */
      }
    };

    const pullInbox = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await api.syncEmailHub(wsId, accountId, "INBOX", false, true);
        refetchIfSynced(res.synced);
      } catch {
        /* retry on next tick */
      }
    };

    void subscribe();
    void pullInbox();

    const heartbeat = window.setInterval(() => {
      if (!cancelled) void subscribe();
    }, emailHubLivePollMs);

    let fallbackTimer: number | undefined;
    if (!readingEmail) {
      fallbackTimer = window.setInterval(() => {
        void pullInbox();
      }, emailHubSafetyPollMs);
    }

    const onVisible = () => {
      void subscribe();
      void pullInbox();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisible);
      void api.unsubscribeEmailHubInboxWatch(wsId, accountId).catch(() => {});
    };
  }, [wsId, accountId, enabled, readingEmail, qc]);
}

export function useMoveEmailHubThread(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; threadId: string; moveTo: api.EmailHubMoveTarget }) =>
      api.moveEmailHubThread(wsId, input.threadId, input.accountId, input.moveTo),
    onSuccess: (_data, input) => {
      qc.removeQueries({ queryKey: emailHubKeys.thread(wsId, input.accountId, input.threadId) });
      invalidateEmailHubThreads(qc, wsId, input.accountId);
    },
  });
}

export function useMarkEmailHubRead(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; threadId: string; isRead: boolean }) =>
      api.patchEmailHubThread(wsId, input.threadId, { accountId: input.accountId, isRead: input.isRead }),
    onSuccess: (thread, input) => {
      if (!thread) return;
      qc.setQueryData(threadDetailKey(wsId, input.accountId, input.threadId), thread);
      invalidateEmailHubThreads(qc, wsId, input.accountId);
    },
  });
}

export function useToggleEmailHubStar(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; threadId: string; isStarred: boolean }) =>
      api.patchEmailHubThread(wsId, input.threadId, {
        accountId: input.accountId,
        isStarred: input.isStarred,
      }),
    onMutate: (input) => {
      patchEmailHubThreadInLists(qc, wsId, input.accountId, input.threadId, { is_starred: input.isStarred });
      const key = threadDetailKey(wsId, input.accountId, input.threadId);
      const prev = qc.getQueryData<EmailHubThread>(key);
      if (prev) {
        qc.setQueryData(key, { ...prev, is_starred: input.isStarred });
      }
      return { prev, key };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(ctx.key, ctx.prev);
      } else {
        patchEmailHubThreadInLists(qc, wsId, input.accountId, input.threadId, {
          is_starred: !input.isStarred,
        });
      }
    },
    onSuccess: (thread, input) => {
      if (thread) {
        qc.setQueryData(threadDetailKey(wsId, input.accountId, input.threadId), thread);
        patchEmailHubThreadInLists(qc, wsId, input.accountId, input.threadId, { is_starred: thread.is_starred });
      }
      invalidateEmailHubThreads(qc, wsId, input.accountId);
    },
  });
}

export function useDownloadEmailHubAttachment(wsId: string) {
  return useMutation({
    mutationFn: (input: { accountId: string; threadId: string; attachmentId: string }) =>
      api.downloadEmailHubAttachment(wsId, input.threadId, input.attachmentId, input.accountId),
  });
}
