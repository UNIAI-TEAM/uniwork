"use client";

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { EmailHubMoveTarget } from "@uniwork/core/api/endpoints/email-hub";
import {
  useDownloadEmailHubAttachment,
  useMarkEmailHubRead,
  useMoveEmailHubThread,
  useSnoozeEmailHubThread,
  useToggleEmailHubStar,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { toastApiError } from "../toast-api-error";
import type { ComposeMode } from "./compose-recipients";
import type { EmailHubFolderKey } from "./email-hub-folders";
import { emailHubSnoozeNextWeekMorning, emailHubSnoozeToRFC3339, emailHubSnoozeTomorrowMorning } from "./email-hub-snooze";
import type { EmailHubSnoozePreset, EmailHubThreadActions, EmailHubThreadPending } from "./email-hub-thread-toolbar";

/** At most this many requests at once: fifty checked rows used to fire fifty moves together. */
const BULK_CONCURRENCY = 4;

async function settleInBatches(ids: string[], run: (id: string) => Promise<unknown>) {
  const results: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < ids.length; i += BULK_CONCURRENCY) {
    results.push(...(await Promise.allSettled(ids.slice(i, i + BULK_CONCURRENCY).map(run))));
  }
  return results;
}

/** Where a moved email went, and how to get to it: a move deletes and re-syncs the row, so there is no undo by id. */
const MOVE_DONE: Record<EmailHubMoveTarget, { key: string; folder: EmailHubFolderKey }> = {
  ARCHIVE: { key: "email_hub.moved.archive", folder: "ARCHIVE" },
  TRASH: { key: "email_hub.moved.trash", folder: "TRASH" },
  SPAM: { key: "email_hub.moved.spam", folder: "SPAM" },
  INBOX: { key: "email_hub.moved.inbox", folder: "INBOX" },
};

interface Options {
  wsId: string;
  accountId: string | null;
  selectedId: string | null;
  activeThread: EmailHubThread | null;
  detailData: EmailHubThread | null | undefined;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setFolder: (folder: EmailHubFolderKey) => void;
  openCompose: (mode: ComposeMode, source?: EmailHubThread | null) => void;
  onToggleAi: () => void;
  refetchDetail: () => void;
}

/**
 * Every action on an email, with its feedback. Failures used to vanish: the
 * moves, star, snooze and download mutations had no error handling at all.
 *
 * Single actions use `mutateAsync` too: `mutate`'s per-call callbacks fire only
 * for the latest call, so a second row's action would swallow the first one's
 * toast. And the reader may have opened another email by the time a request
 * lands, so success closes only the email the request was about.
 */
export function useEmailHubThreadActions({
  wsId,
  accountId,
  selectedId,
  activeThread,
  detailData,
  setSelectedId,
  setFolder,
  openCompose,
  onToggleAi,
  refetchDetail,
}: Options) {
  const { t } = useTranslation();
  const moveThread = useMoveEmailHubThread(wsId);
  const toggleStar = useToggleEmailHubStar(wsId);
  const markRead = useMarkEmailHubRead(wsId);
  const snoozeThread = useSnoozeEmailHubThread(wsId);
  const downloadAttachment = useDownloadEmailHubAttachment(wsId);
  const [snoozeDialogOpen, setSnoozeDialogOpen] = useState(false);

  const fail = useCallback((err: unknown) => toastApiError(err, t("email_hub.action_error")), [t]);
  const closeIfOpen = useCallback(
    (threadId: string) => setSelectedId((cur) => (cur === threadId ? null : cur)),
    [setSelectedId],
  );

  const move = useCallback(
    (threadId: string, moveTo: EmailHubMoveTarget) => {
      if (!accountId) return;
      moveThread
        .mutateAsync({ accountId, threadId, moveTo })
        .then(() => {
          closeIfOpen(threadId);
          const done = MOVE_DONE[moveTo];
          toast.success(t(done.key), {
            action:
              moveTo === "INBOX"
                ? undefined
                : { label: t("email_hub.moved.open_folder"), onClick: () => setFolder(done.folder) },
          });
        })
        .catch(fail);
    },
    [accountId, closeIfOpen, fail, moveThread, setFolder, t],
  );

  const star = useCallback(
    (threadId: string, isStarred: boolean) => {
      if (!accountId) return;
      toggleStar.mutateAsync({ accountId, threadId, isStarred: !isStarred }).catch(fail);
    },
    [accountId, fail, toggleStar],
  );

  const setRead = useCallback(
    (threadId: string, isRead: boolean, onSuccess?: () => void) => {
      if (!accountId) return;
      markRead
        .mutateAsync({ accountId, threadId, isRead })
        .then(() => onSuccess?.())
        .catch(fail);
    },
    [accountId, fail, markRead],
  );

  const snoozeUntil = useCallback(
    (when: Date) => {
      if (!accountId || !selectedId) return;
      const threadId = selectedId;
      snoozeThread
        .mutateAsync({ accountId, threadId, snoozeUntil: emailHubSnoozeToRFC3339(when) })
        .then(() => {
          setSnoozeDialogOpen(false);
          closeIfOpen(threadId);
          toast.success(t("email_hub.snooze.done"));
        })
        .catch(fail);
    },
    [accountId, closeIfOpen, fail, selectedId, snoozeThread, t],
  );

  /**
   * Bulk moves and read flags. `mutateAsync`, not `mutate`: a mutation's
   * per-call callbacks fire only for the latest `mutate`, so a loop of them
   * would report one result for the whole batch.
   */
  const [bulkPending, setBulkPending] = useState(false);
  const runBulk = useCallback(
    async (ids: string[], run: (threadId: string) => Promise<unknown>, doneKey: string) => {
      if (!accountId || ids.length === 0) return;
      setBulkPending(true);
      const results = await settleInBatches(ids, run);
      setBulkPending(false);
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) toast.error(t("email_hub.bulk.partial_error", { count: failed }));
      const ok = ids.length - failed;
      if (ok > 0) toast.success(t(doneKey, { count: ok }));
    },
    [accountId, t],
  );
  const bulkMove = useCallback(
    (ids: string[], moveTo: EmailHubMoveTarget) =>
      runBulk(
        ids,
        (threadId) => moveThread.mutateAsync({ accountId: accountId!, threadId, moveTo }),
        moveTo === "TRASH" ? "email_hub.bulk.trashed" : "email_hub.bulk.archived",
      ),
    [accountId, moveThread, runBulk],
  );
  const bulkRead = useCallback(
    (ids: string[], isRead: boolean) =>
      runBulk(
        ids,
        (threadId) => markRead.mutateAsync({ accountId: accountId!, threadId, isRead }),
        isRead ? "email_hub.bulk.marked_read" : "email_hub.bulk.marked_unread",
      ),
    [accountId, markRead, runBulk],
  );

  const source = detailData ?? activeThread;

  const actions: EmailHubThreadActions = useMemo(
    () => ({
      onBack: () => setSelectedId(null),
      onToggleStar: () => {
        if (selectedId && activeThread) star(selectedId, activeThread.is_starred);
      },
      onReply: () => openCompose("reply", source),
      onReplyAll: () => openCompose("replyAll", source),
      onForward: () => openCompose("forward", source),
      onMarkUnread: () => {
        const threadId = selectedId;
        if (threadId) setRead(threadId, false, () => closeIfOpen(threadId));
      },
      onRestoreInbox: () => {
        if (selectedId) move(selectedId, "INBOX");
      },
      onNotSpam: () => {
        if (selectedId) move(selectedId, "INBOX");
      },
      onArchive: () => {
        if (selectedId) move(selectedId, "ARCHIVE");
      },
      onSpam: () => {
        if (selectedId) move(selectedId, "SPAM");
      },
      onTrash: () => {
        if (selectedId) move(selectedId, "TRASH");
      },
      onClearSnooze: () => {
        if (!accountId || !selectedId) return;
        const threadId = selectedId;
        snoozeThread
          .mutateAsync({ accountId, threadId, clearSnooze: true })
          .then(() => {
            closeIfOpen(threadId);
            toast.success(t("email_hub.snooze.cleared"));
          })
          .catch(fail);
      },
      onSnooze: (preset: EmailHubSnoozePreset) => {
        if (preset === "custom") setSnoozeDialogOpen(true);
        else snoozeUntil(preset === "tomorrow" ? emailHubSnoozeTomorrowMorning() : emailHubSnoozeNextWeekMorning());
      },
      onToggleAi,
      onRefetch: refetchDetail,
      onDownloadAttachment: (att) => {
        if (!accountId || !selectedId) return;
        downloadAttachment.mutate(
          { accountId, threadId: selectedId, attachmentId: att.id },
          {
            onSuccess: (blob) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = att.filename || "attachment";
              document.body.appendChild(a);
              a.click();
              a.remove();
              // Revoking in the same tick cancels the download in Safari and Firefox.
              window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
            },
            onError: fail,
          },
        );
      },
    }),
    [
      accountId,
      activeThread,
      closeIfOpen,
      downloadAttachment,
      fail,
      move,
      onToggleAi,
      openCompose,
      refetchDetail,
      selectedId,
      setRead,
      setSelectedId,
      snoozeThread,
      snoozeUntil,
      source,
      star,
      t,
    ],
  );

  const pending: EmailHubThreadPending = {
    star: toggleStar.isPending,
    move: moveThread.isPending,
    markRead: markRead.isPending,
    snooze: snoozeThread.isPending,
    download: downloadAttachment.isPending,
  };

  return {
    actions,
    pending,
    bulkMove,
    bulkRead,
    bulkPending,
    move,
    star,
    setRead,
    snoozeDialog: {
      open: snoozeDialogOpen,
      onOpenChange: setSnoozeDialogOpen,
      pending: snoozeThread.isPending,
      onConfirm: snoozeUntil,
    },
  };
}
