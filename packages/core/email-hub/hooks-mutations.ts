import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailHubThread } from "../types/email-hub";
import * as api from "../api/endpoints/email-hub";
import { invalidateTaskCollections } from "../tasks/invalidate";
import {
  emailHubKeys,
  invalidateEmailHubCounts,
  invalidateEmailHubThreads,
  invalidateEmailHubThreadsForAccount,
  patchEmailHubThreadInLists,
  removeEmailHubThreadFromLists,
  threadDetailKey,
} from "./query-cache";

export function useSyncEmailHub(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; folder?: string; force?: boolean; reconcile?: boolean }) =>
      api.syncEmailHub(wsId, input.accountId, input.folder, input.force, false, input.reconcile),
    onSuccess: (result, input) => {
      if (result?.synced) {
        invalidateEmailHubThreadsForAccount(qc, wsId, input.accountId);
        invalidateEmailHubCounts(qc, wsId, input.accountId);
        void qc.invalidateQueries({ queryKey: emailHubKeys.accounts(wsId) });
        void qc.invalidateQueries({
          predicate: (q) => q.queryKey[0] === "email-hub" && q.queryKey[2] === "imap-labels",
        });
      }
    },
  });
}

export function useSendEmailHub(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.SendEmailHubInput) => api.sendEmailHub(wsId, input),
    onSuccess: (result, input) => {
      if (!result) return;
      if ("scheduled" in result && result.scheduled) {
        const key = emailHubKeys.scheduledSends(wsId, input.accountId);
        qc.setQueryData(key, (old: { scheduled: api.EmailHubScheduledSendItem[] } | undefined) => {
          const prev = old?.scheduled ?? [];
          if (prev.some((row) => row.id === result.id)) return old;
          return {
            scheduled: [
              {
                id: result.id,
                send_at: result.send_at,
                subject: result.subject,
                to: result.to,
                status: "pending",
              },
              ...prev,
            ],
          };
        });
        void qc.invalidateQueries({ queryKey: key });
        return;
      }
      qc.setQueryData(threadDetailKey(wsId, input.accountId, result.id), result);
      invalidateEmailHubThreads(qc, wsId, input.accountId);
      if (input.replyToThreadId) {
        void qc.invalidateQueries({
          queryKey: emailHubKeys.conversation(wsId, input.accountId, input.replyToThreadId),
        });
      }
      void qc.invalidateQueries({
        queryKey: emailHubKeys.conversation(wsId, input.accountId, result.id),
      });
    },
  });
}

export function useMoveEmailHubThread(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; threadId: string; moveTo: api.EmailHubMoveTarget }) =>
      api.moveEmailHubThread(wsId, input.threadId, input.accountId, input.moveTo),
    onMutate: (input) => {
      const detailKey = threadDetailKey(wsId, input.accountId, input.threadId);
      const prevDetail = qc.getQueryData<EmailHubThread>(detailKey);
      removeEmailHubThreadFromLists(qc, wsId, input.accountId, input.threadId);
      qc.removeQueries({ queryKey: emailHubKeys.thread(wsId, input.accountId, input.threadId) });
      return { prevDetail, detailKey };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.prevDetail) {
        qc.setQueryData(ctx.detailKey, ctx.prevDetail);
      }
      invalidateEmailHubThreads(qc, wsId, input.accountId);
      invalidateEmailHubCounts(qc, wsId, input.accountId);
    },
    onSuccess: (_data, input) => {
      invalidateEmailHubCounts(qc, wsId, input.accountId);
    },
  });
}

export function useMarkEmailHubRead(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; threadId: string; isRead: boolean }) =>
      api.patchEmailHubThread(wsId, input.threadId, { accountId: input.accountId, isRead: input.isRead }),
    onMutate: (input) => {
      patchEmailHubThreadInLists(qc, wsId, input.accountId, input.threadId, { is_read: input.isRead });
      const key = threadDetailKey(wsId, input.accountId, input.threadId);
      const prev = qc.getQueryData<EmailHubThread>(key);
      if (prev) {
        qc.setQueryData(key, { ...prev, is_read: input.isRead });
      }
      return { prev, key };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(ctx.key, ctx.prev);
      } else {
        patchEmailHubThreadInLists(qc, wsId, input.accountId, input.threadId, { is_read: !input.isRead });
      }
    },
    onSuccess: (thread, input) => {
      if (!thread) return;
      qc.setQueryData(threadDetailKey(wsId, input.accountId, input.threadId), thread);
      patchEmailHubThreadInLists(qc, wsId, input.accountId, input.threadId, { is_read: thread.is_read });
      invalidateEmailHubCounts(qc, wsId, input.accountId);
    },
  });
}

export function useSnoozeEmailHubThread(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      accountId: string;
      threadId: string;
      snoozeUntil?: string;
      clearSnooze?: boolean;
    }) =>
      api.patchEmailHubThread(wsId, input.threadId, {
        accountId: input.accountId,
        snoozeUntil: input.snoozeUntil,
        clearSnooze: input.clearSnooze,
      }),
    onMutate: (input) => {
      const detailKey = threadDetailKey(wsId, input.accountId, input.threadId);
      const prevDetail = qc.getQueryData<EmailHubThread>(detailKey);
      // Snooze hides from inbox; clear-snooze brings it back via invalidate.
      if (!input.clearSnooze) {
        removeEmailHubThreadFromLists(qc, wsId, input.accountId, input.threadId);
      }
      return { prevDetail, detailKey };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.prevDetail) {
        qc.setQueryData(ctx.detailKey, ctx.prevDetail);
      }
      invalidateEmailHubThreads(qc, wsId, input.accountId);
      invalidateEmailHubCounts(qc, wsId, input.accountId);
    },
    onSuccess: (thread, input) => {
      if (thread) {
        qc.setQueryData(threadDetailKey(wsId, input.accountId, input.threadId), thread);
      }
      if (input.clearSnooze) {
        invalidateEmailHubThreads(qc, wsId, input.accountId);
      }
      invalidateEmailHubCounts(qc, wsId, input.accountId);
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
      // Star already patched lists in onMutate; avoid refetching the whole folder.
      invalidateEmailHubCounts(qc, wsId, input.accountId);
    },
  });
}

export function useCancelEmailHubScheduledSend(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; scheduledId: string }) =>
      api.cancelEmailHubScheduledSend(wsId, input.accountId, input.scheduledId),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: emailHubKeys.scheduledSends(wsId, input.accountId) });
    },
  });
}

export function useRetryEmailHubScheduledSend(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; scheduledId: string }) =>
      api.retryEmailHubScheduledSend(wsId, input.accountId, input.scheduledId),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: emailHubKeys.scheduledSends(wsId, input.accountId) });
    },
  });
}

export function useDownloadEmailHubAttachment(wsId: string) {
  return useMutation({
    mutationFn: (input: { accountId: string; threadId: string; attachmentId: string }) =>
      api.downloadEmailHubAttachment(wsId, input.threadId, input.attachmentId, input.accountId),
  });
}

export function useSummarizeEmailHubThread(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; threadId: string; locale: string; force?: boolean }) =>
      api.summarizeEmailHubThread(wsId, input.accountId, input.threadId, input.locale, {
        force: input.force,
      }),
    onSuccess: (data, input) => {
      if (!data.summary) return;
      qc.setQueryData(
        emailHubKeys.threadSummary(wsId, input.accountId, input.threadId, input.locale),
        data,
      );
    },
  });
}

export function useCreateEmailHubSummaryTasks(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      accountId: string;
      threadId: string;
      items: api.EmailHubSummaryTaskItem[];
    }) => api.createEmailHubSummaryTasks(wsId, input.accountId, input.threadId, input.items),
    // Settled, not success: whatever the answer, the boards re-read the server.
    onSettled: () => invalidateTaskCollections(qc, wsId),
  });
}
