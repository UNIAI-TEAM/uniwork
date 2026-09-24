import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailHubThread } from "../types/email-hub";
import * as api from "../api/endpoints/email-hub";
import {
  emailHubKeys,
  invalidateEmailHubThreads,
  invalidateEmailHubThreadsForAccount,
  invalidateEmailHubUnread,
  patchEmailHubThreadInLists,
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
        invalidateEmailHubUnread(qc, wsId);
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
        void qc.invalidateQueries({ queryKey: ["email-hub", wsId, "scheduled", input.accountId] });
        return;
      }
      qc.setQueryData(threadDetailKey(wsId, input.accountId, result.id), result);
      invalidateEmailHubThreads(qc, wsId, input.accountId);
    },
  });
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
      invalidateEmailHubUnread(qc, wsId);
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
    onSuccess: (thread, input) => {
      if (thread) {
        qc.setQueryData(threadDetailKey(wsId, input.accountId, input.threadId), thread);
      }
      invalidateEmailHubThreads(qc, wsId, input.accountId);
      invalidateEmailHubUnread(qc, wsId);
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

export function useCancelEmailHubScheduledSend(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; scheduledId: string }) =>
      api.cancelEmailHubScheduledSend(wsId, input.accountId, input.scheduledId),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["email-hub", wsId, "scheduled", input.accountId] });
    },
  });
}

export function useRetryEmailHubScheduledSend(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; scheduledId: string }) =>
      api.retryEmailHubScheduledSend(wsId, input.accountId, input.scheduledId),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["email-hub", wsId, "scheduled", input.accountId] });
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", wsId] });
    },
  });
}
