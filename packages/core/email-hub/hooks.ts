import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  EmailHubCustomServer,
  EmailHubOAuthProvider,
  EmailHubThread,
  EmailHubThreadFilters,
} from "../types/email-hub";
import * as api from "../api/endpoints/email-hub";
import {
  emailHubKeys,
  flushEmailHubListRefresh,
  invalidateEmailHubCounts,
  invalidateEmailHubThreads,
  invalidateEmailHubUnread,
  invalidateEmailHubReadingCachesForAccount,
  patchEmailHubThreadInLists,
  setEmailHubListRefreshPaused,
  threadDetailKey,
} from "./query-cache";

export {
  emailHubKeys,
  flushEmailHubListRefresh,
  invalidateEmailHubCounts,
  invalidateEmailHubThreadsForAccount,
  invalidateEmailHubReadingCachesForAccount,
  invalidateEmailHubUnread,
  patchEmailHubThreadInLists,
  setEmailHubListRefreshPaused,
} from "./query-cache";

export {
  emailHubLazySyncShowsSyncing,
  useEmailHubLazyFolderSync,
  useEmailHubLiveSync,
} from "./hooks-sync";

export {
  useCancelEmailHubScheduledSend,
  useCreateEmailHubSummaryTasks,
  useDownloadEmailHubAttachment,
  useMarkEmailHubRead,
  useMoveEmailHubThread,
  useRetryEmailHubScheduledSend,
  useSendEmailHub,
  useSnoozeEmailHubThread,
  useSummarizeEmailHubThread,
  useSyncEmailHub,
  useToggleEmailHubStar,
} from "./hooks-mutations";

export type EmailHubThreadsQueryOptions = {
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
};

const EMAIL_HUB_THREAD_STALE_TIME_MS = 30_000;

export function useEmailHubUnreadCount(wsId: string) {
  return useQuery({
    queryKey: emailHubKeys.unread(wsId),
    queryFn: () => api.getEmailHubUnreadCount(wsId),
    staleTime: 30_000,
  });
}

export function useEmailHubSidebarCounts(wsId: string, accountId: string | null) {
  return useQuery({
    queryKey: emailHubKeys.sidebarCounts(wsId, accountId ?? ""),
    queryFn: () => api.getEmailHubSidebarCounts(wsId, accountId!),
    enabled: !!accountId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useEmailHubImapLabels(wsId: string, accountId: string | null) {
  return useQuery({
    queryKey: emailHubKeys.imapLabels(wsId, accountId ?? ""),
    queryFn: () => api.listEmailHubImapLabels(wsId, accountId!),
    enabled: !!accountId,
    staleTime: 60_000,
  });
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
  queryEnabled = true,
  queryOptions?: EmailHubThreadsQueryOptions,
) {
  return useInfiniteQuery({
    queryKey: emailHubKeys.threads(wsId, accountId ?? "", folder, filters),
    queryFn: ({ pageParam, signal }) =>
      api.listEmailHubThreads(
        wsId,
        accountId!,
        folder,
        filters,
        pageParam as string | undefined,
        undefined,
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!accountId && queryEnabled,
    staleTime: queryOptions?.staleTime ?? 5_000,
    refetchOnWindowFocus: queryOptions?.refetchOnWindowFocus ?? true,
  });
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

/** Body was stripped from cache; a body fetch is in flight or pending. */
export function emailHubBodyAwaitingMailboxRefetch(
  thread:
    | { body_html?: string; body_text?: string; snippet?: string; body_cached?: boolean }
    | null
    | undefined,
  fetchActive: boolean,
) {
  if (!thread || emailHubHasReadableBody(thread)) return false;
  if (thread.body_cached === true) return false;
  const hasSnippet = !!thread.snippet?.trim();
  return hasSnippet && fetchActive;
}

export function emailHubHasReadableBody(
  thread:
    | { body_html?: string; body_text?: string; snippet?: string; body_cached?: boolean }
    | null
    | undefined,
) {
  if (!thread) return false;
  if (thread.body_html?.trim()) return true;
  const text = thread.body_text?.trim() ?? "";
  if (!text) return false;
  if (thread.body_cached) return true;
  return !emailHubBodyIsPlaceholder(thread);
}

/** One request on open (meta + body + mark read) for minimum latency. */
export function useEmailHubConversation(
  wsId: string,
  accountId: string | null,
  threadId: string | null,
) {
  return useQuery({
    queryKey: emailHubKeys.conversation(wsId, accountId ?? "", threadId ?? ""),
    queryFn: ({ signal }) => api.getEmailHubConversation(wsId, accountId!, threadId!, signal),
    enabled: !!accountId && !!threadId,
    staleTime: 10_000,
  });
}

export function useEmailHubThread(
  wsId: string,
  accountId: string | null,
  threadId: string | null,
  _listHint?: EmailHubThread | null,
) {
  const qc = useQueryClient();
  void _listHint;
  const detail = useQuery({
    queryKey: threadDetailKey(wsId, accountId ?? "", threadId ?? ""),
    queryFn: ({ signal }): Promise<EmailHubThread | null> =>
      api.getEmailHubThread(wsId, accountId!, threadId!, true, true, signal),
    enabled: !!accountId && !!threadId,
    // List rows carry snippet-only metadata; never hydrate the detail cache from them.
    placeholderData: (previous) => (previous?.id === threadId ? previous : undefined),
    staleTime: EMAIL_HUB_THREAD_STALE_TIME_MS,
    // Prefetch can land snippet-only while still "fresh"; force a real open fetch.
    refetchOnMount: (query) =>
      emailHubHasReadableBody(query.state.data ?? undefined) ? false : "always",
    retry: (failureCount, error) => failureCount < 2 && error != null,
  });
  const data = detail.data?.id === threadId ? detail.data : undefined;
  const bodyRetryRef = useRef({ threadId: "", attempts: 0 });
  const [bodyAutoRetrying, setBodyAutoRetrying] = useState(false);
  const [bodyAutoRetriesExhausted, setBodyAutoRetriesExhausted] = useState(false);
  const refetchDetail = detail.refetch;
  useEffect(() => {
    if (!accountId || !threadId) return;
    if (threadId !== bodyRetryRef.current.threadId) {
      bodyRetryRef.current = { threadId, attempts: 0 };
      setBodyAutoRetrying(false);
      setBodyAutoRetriesExhausted(false);
    }
    if (emailHubHasReadableBody(data)) {
      setBodyAutoRetrying(false);
      setBodyAutoRetriesExhausted(false);
      return;
    }
    if (detail.isFetching || detail.isPending) return;
    if (!detail.isFetched && !detail.isError) return;
    if (bodyRetryRef.current.attempts >= 2) {
      setBodyAutoRetrying(false);
      setBodyAutoRetriesExhausted(true);
      return;
    }
    bodyRetryRef.current.attempts += 1;
    setBodyAutoRetrying(true);
    const delayMs = bodyRetryRef.current.attempts * 350;
    const timer = window.setTimeout(() => {
      void refetchDetail().finally(() => {
        setBodyAutoRetrying(false);
      });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    accountId,
    data,
    detail.isError,
    detail.isFetched,
    detail.isFetching,
    detail.isPending,
    refetchDetail,
    threadId,
  ]);
  useEffect(() => {
    if (!accountId || !threadId || !data?.is_read) return;
    patchEmailHubThreadInLists(qc, wsId, accountId, threadId, { is_read: true });
  }, [accountId, threadId, data?.is_read, qc, wsId]);
  const awaitingBody = !!threadId && !emailHubHasReadableBody(data);
  const isBodyLoading =
    awaitingBody &&
    (detail.isFetching || detail.isLoading || detail.isPending || bodyAutoRetrying);
  const isBodyLoadFailed =
    awaitingBody &&
    !isBodyLoading &&
    bodyAutoRetriesExhausted &&
    (detail.isFetched || detail.isError);

  const refetchBody = () => {
    bodyRetryRef.current.attempts = 0;
    setBodyAutoRetriesExhausted(false);
    setBodyAutoRetrying(false);
    return detail.refetch();
  };

  return {
    ...detail,
    data,
    isLoading: detail.isLoading && !data,
    isBodyLoading,
    isBodyLoadFailed,
    isError: detail.isError,
    error: detail.error,
    refetchBody,
  };
}

export function prefetchEmailHubThread(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string,
  accountId: string,
  threadId: string,
  fetchBody = true,
) {
  const key = threadDetailKey(wsId, accountId, threadId);
  void qc
    .prefetchQuery({
      queryKey: key,
      queryFn: ({ signal }) =>
        api.getEmailHubThread(wsId, accountId, threadId, fetchBody, false, signal),
      staleTime: EMAIL_HUB_THREAD_STALE_TIME_MS,
      retry: 1,
    })
    .then(() => {
      const cached = qc.getQueryData<EmailHubThread | null>(key);
      if (cached && !emailHubHasReadableBody(cached)) {
        void qc.invalidateQueries({ queryKey: key, refetchType: "none" });
      }
    });
}

export function useConnectEmailHubAccount(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; appPassword: string; server?: EmailHubCustomServer }) =>
      api.connectEmailHubAccount(wsId, input.email, input.appPassword, input.server),
    onSuccess: (acc) => {
      void qc.invalidateQueries({ queryKey: emailHubKeys.accounts(wsId) });
      if (acc?.id) {
        void api.syncEmailHub(wsId, acc.id, undefined, true, false, true).then(
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
      invalidateEmailHubUnread(qc, wsId);
    },
  });
}

export function useEmailHubProviders(wsId: string) {
  return useQuery({
    queryKey: emailHubKeys.providers(wsId),
    queryFn: () => api.getEmailHubProviders(wsId),
    // Server configuration: it changes on a deploy, not while the dialog is open.
    staleTime: 5 * 60_000,
  });
}

/** Resolves the sign-in URL. The account appears only after the callback, so the cache is left alone here. */
export function useStartEmailHubOAuth(wsId: string) {
  return useMutation({
    mutationFn: (input: { provider: EmailHubOAuthProvider; loginHint?: string }) =>
      api.startEmailHubOAuth(wsId, input.provider, input.loginHint),
  });
}

export function useEmailHubScheduledSends(wsId: string, accountId: string | null) {
  return useQuery({
    queryKey: ["email-hub", wsId, "scheduled", accountId ?? ""] as const,
    queryFn: () => api.listEmailHubScheduledSends(wsId, accountId!),
    enabled: !!accountId,
    staleTime: 10_000,
  });
}

export function useEmailHubThreadSummary(
  wsId: string,
  accountId: string | null,
  threadId: string | null,
  locale: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: emailHubKeys.threadSummary(wsId, accountId ?? "", threadId ?? "", locale),
    queryFn: () => api.getEmailHubThreadSummary(wsId, accountId!, threadId!, locale),
    enabled: enabled && !!accountId && !!threadId,
    staleTime: 60_000,
  });
}
