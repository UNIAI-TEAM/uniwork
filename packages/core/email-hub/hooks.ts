import { useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { EmailHubThread, EmailHubThreadFilters } from "../types/email-hub";
import * as api from "../api/endpoints/email-hub";
import {
  emailHubKeys,
  flushEmailHubListRefresh,
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

export function useEmailHubUnreadCount(wsId: string) {
  return useQuery({
    queryKey: emailHubKeys.unread(wsId),
    queryFn: () => api.getEmailHubUnreadCount(wsId),
    staleTime: 30_000,
  });
}

export function useEmailHubSidebarCounts(wsId: string, accountId: string | null) {
  return useQuery({
    queryKey: ["email-hub", wsId, "sidebar-counts", accountId ?? ""] as const,
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
    queryFn: ({ pageParam }) =>
      api.listEmailHubThreads(wsId, accountId!, folder, filters, pageParam as string | undefined),
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
    staleTime: 30_000,
    refetchOnMount: "always",
    retry: 2,
  });
  const data = detail.data?.id === threadId ? detail.data : undefined;
  useEffect(() => {
    if (!accountId || !threadId || !data?.is_read) return;
    patchEmailHubThreadInLists(qc, wsId, accountId, threadId, { is_read: true });
  }, [accountId, threadId, data?.is_read, qc, wsId]);
  const awaitingBody = !!threadId && !emailHubHasReadableBody(data);
  const isBodyLoading =
    awaitingBody && (detail.isFetching || detail.isLoading || detail.isPending);
  const isBodyLoadFailed =
    awaitingBody && !isBodyLoading && (detail.isFetched || detail.isError);

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
    staleTime: 0,
    retry: 1,
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
