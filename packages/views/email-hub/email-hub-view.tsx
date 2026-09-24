"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { errorCode } from "@uniwork/core/api/http";
import {
  emailHubHasReadableBody,
  emailHubKeys,
  flushEmailHubListRefresh,
  prefetchEmailHubThread,
  setEmailHubListRefreshPaused,
  useCancelEmailHubScheduledSend,
  useEmailHubAccounts,
  useEmailHubImapLabels,
  useEmailHubScheduledSends,
  useEmailHubThread,
  useEmailHubThreads,
  useDownloadEmailHubAttachment,
  useDisconnectEmailHubAccount,
  useEmailHubLazyFolderSync,
  useEmailHubLiveSync,
  useMarkEmailHubRead,
  useSnoozeEmailHubThread,
  useMoveEmailHubThread,
  useSyncEmailHub,
  useSummarizeEmailHubThread,
  useToggleEmailHubStar,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubThread, EmailHubThreadSummary } from "@uniwork/core/types/email-hub";
import { toastApiError } from "../toast-api-error";
import { useWorkspace } from "../layout/workspace-context";
import type { ComposeMode } from "./compose-recipients";
import { EmailHubViewDialogs } from "./email-hub-view-dialogs";
import { EmailHubFolderSidebar, type EmailHubFolderKey } from "./email-hub-folder-sidebar";
import { useEmailHubAccountPanel } from "./use-email-hub-account-panel";
import { EmailHubStatsRail } from "./email-hub-stats-rail";
import { emailHubSnoozeNextWeekMorning, emailHubSnoozeToRFC3339, emailHubSnoozeTomorrowMorning } from "./email-hub-snooze";
import { EmailHubViewDetailPanel } from "./email-hub-view-detail-panel";
import { EmailHubViewListPanel } from "./email-hub-view-list-panel";

type FolderKey = EmailHubFolderKey;
type MailFolderKey = Exclude<FolderKey, "SCHEDULED">;

export function EmailHubView() {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const wsId = workspace.id;
  const qc = useQueryClient();
  const accounts = useEmailHubAccounts(wsId);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderKey>("INBOX");
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [hasAttachmentsOnly, setHasAttachmentsOnly] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [composeSource, setComposeSource] = useState<EmailHubThread | null>(null);
  const imapLabelsQuery = useEmailHubImapLabels(wsId, accountId);
  const imapLabels = useMemo(() => imapLabelsQuery.data?.labels ?? [], [imapLabelsQuery.data?.labels]);
  const sync = useSyncEmailHub(wsId);
  const disconnect = useDisconnectEmailHubAccount(wsId);
  const moveThread = useMoveEmailHubThread(wsId);
  const toggleStar = useToggleEmailHubStar(wsId);
  const markRead = useMarkEmailHubRead(wsId);
  const snoozeThread = useSnoozeEmailHubThread(wsId);
  const downloadAttachment = useDownloadEmailHubAttachment(wsId);
  const summarizeThread = useSummarizeEmailHubThread(wsId);
  const { data: aiCaps } = useAiCapabilities(wsId);
  const aiEnabled = !!aiCaps?.enabled;
  const [threadAiSummaries, setThreadAiSummaries] = useState<Record<string, EmailHubThreadSummary>>({});
  const [analyzingThreadId, setAnalyzingThreadId] = useState<string | null>(null);
  const isScheduledFolder = folder === "SCHEDULED";
  const mailFolder: MailFolderKey = isScheduledFolder ? "INBOX" : folder;
  const scheduled = useEmailHubScheduledSends(wsId, accountId);
  const cancelScheduled = useCancelEmailHubScheduledSend(wsId);
  const readingEmail = !!selectedId;
  useEmailHubLiveSync(wsId, accountId, folder === "INBOX" || folder === "STARRED", readingEmail && !isScheduledFolder);
  const snoozedMeta = useEmailHubThreads(wsId, accountId, "SNOOZED", {}, !!accountId, {
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  const snoozedCount = snoozedMeta.data?.pages[0]?.counts.total ?? 0;

  const analyzeFromList = useCallback(
    (threadId: string) => {
      if (!accountId || !aiEnabled) return;
      setAnalyzingThreadId(threadId);
      const locale = i18n.language.startsWith("en") ? "en" : "vi";
      summarizeThread.mutate(
        { accountId, threadId, locale },
        {
          onSuccess: (data) => {
            if (data.summary) {
              setThreadAiSummaries((prev) => ({ ...prev, [threadId]: data }));
            }
          },
          onError: (err) => {
            if (errorCode(err) === "nothing_to_summarize") {
              toast.error(t("email_hub.ai.nothing_to_summarize"));
              return;
            }
            toastApiError(err, t("email_hub.load_error"));
          },
          onSettled: () => setAnalyzingThreadId(null),
        },
      );
    },
    [accountId, aiEnabled, i18n.language, summarizeThread, t],
  );

  const handleThreadAiSummary = useCallback(
    (data: EmailHubThreadSummary) => {
      if (!selectedId) return;
      setThreadAiSummaries((prev) => {
        const cur = prev[selectedId];
        if (
          cur?.summary === data.summary &&
          cur?.cached === data.cached &&
          cur?.summarized_at === data.summarized_at
        ) {
          return prev;
        }
        return { ...prev, [selectedId]: data };
      });
    },
    [selectedId],
  );

  useEffect(() => {
    if (!accountId) return;
    setEmailHubListRefreshPaused(wsId, accountId, readingEmail);
    if (!readingEmail) {
      flushEmailHubListRefresh(qc, wsId, accountId);
    }
  }, [accountId, qc, readingEmail, wsId]);

  const filters = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      label: selectedLabel || undefined,
      unreadOnly,
      hasAttachmentsOnly,
    }),
    [debouncedSearch, selectedLabel, unreadOnly, hasAttachmentsOnly],
  );
  const threads = useEmailHubThreads(wsId, accountId, mailFolder, filters, !isScheduledFolder);
  const lazyMailFolder =
    isScheduledFolder || folder === "STARRED" || folder === "SNOOZED" ? "" : mailFolder;
  const folderSyncing = useEmailHubLazyFolderSync(wsId, accountId, lazyMailFolder, {
    listFetched: threads.isFetched,
    listTotal: threads.data?.pages[0]?.counts.total ?? 0,
    skip: !!debouncedSearch || unreadOnly || hasAttachmentsOnly,
  });
  const scheduledRows = useMemo(() => scheduled.data?.scheduled ?? [], [scheduled.data?.scheduled]);
  const selectedScheduled = useMemo(
    () => scheduledRows.find((row) => row.id === selectedId) ?? null,
    [scheduledRows, selectedId],
  );
  const rows = useMemo(() => threads.data?.pages.flatMap((page) => page.threads) ?? [], [threads.data]);
  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const detail = useEmailHubThread(wsId, accountId, isScheduledFolder ? null : selectedId, selectedRow);

  useEffect(() => {
    if (!selectedId || !accountId || isScheduledFolder) return;
    if (debouncedSearch || unreadOnly || hasAttachmentsOnly) return;
    if (threads.isFetching || !threads.isFetched) return;
    if (rows.some((row) => row.id === selectedId)) return;
    const goneId = selectedId;
    setSelectedId(null);
    void qc.removeQueries({ queryKey: emailHubKeys.thread(wsId, accountId, goneId) });
  }, [
    accountId,
    debouncedSearch,
    hasAttachmentsOnly,
    isScheduledFolder,
    qc,
    rows,
    selectedId,
    threads.isFetched,
    threads.isFetching,
    unreadOnly,
    wsId,
  ]);

  const accountList = useMemo(() => {
    const list = accounts.data?.accounts ?? [];
    const byEmail = new Map<string, (typeof list)[number]>();
    for (const acc of list) {
      byEmail.set(acc.email_address, acc);
    }
    return [...byEmail.values()];
  }, [accounts.data]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 500);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    const latest = accountList.at(-1)?.id;
    if (latest && !accountId) setAccountId(latest);
  }, [accountList, accountId]);

  const prefetchThread = useCallback(
    (threadId: string) => {
      if (!accountId || threadId === selectedId) return;
      prefetchEmailHubThread(qc, wsId, accountId, threadId);
    },
    [accountId, qc, wsId, selectedId],
  );

  const openCompose = useCallback((mode: ComposeMode, source?: EmailHubThread | null) => {
    setComposeMode(mode);
    setComposeSource(source ?? null);
    setComposeOpen(true);
  }, []);

  const selectThread = useCallback(
    (threadId: string) => {
      if (!accountId) {
        setSelectedId(threadId);
        return;
      }
      void qc.cancelQueries({ queryKey: ["email-hub", wsId, "thread", accountId, threadId] });
      setSelectedId(threadId);
      const row = rows.find((item) => item.id === threadId);
      if (row && !row.is_read) {
        markRead.mutate({ accountId, threadId, isRead: true });
      }
    },
    [accountId, markRead, qc, rows, wsId],
  );

  const handleToggleStar = useCallback(
    (threadId: string, isStarred: boolean) => {
      if (!accountId) return;
      toggleStar.mutate({ accountId, threadId, isStarred: !isStarred });
    },
    [accountId, toggleStar],
  );

  const onNotSpamFromList = useCallback(
    (threadId: string) => {
      if (!accountId) return;
      moveThread.mutate(
        { accountId, threadId, moveTo: "INBOX" },
        {
          onSuccess: () => {
            if (selectedId === threadId) setSelectedId(null);
            toast.success(t("email_hub.not_spam_done"));
          },
        },
      );
    },
    [accountId, moveThread, selectedId, t],
  );

  useEffect(() => {
    if (!accountId || rows.length === 0) return;
    for (const row of rows.slice(0, 5)) {
      if (row.id === selectedId) continue;
      prefetchEmailHubThread(qc, wsId, accountId, row.id);
    }
  }, [accountId, rows, qc, wsId, selectedId]);

  const counts = threads.data?.pages[0]?.counts ?? { total: 0, unread: 0 };
  const searching = !!debouncedSearch && threads.isFetching && !threads.isFetchingNextPage;
  const activeThread =
    detail.data?.id === selectedId ? detail.data : selectedRow?.id === selectedId ? selectedRow : null;
  const readableBody = emailHubHasReadableBody(detail.data);
  const bodyLoading = detail.isBodyLoading;
  const bodyLoadFailed = detail.isBodyLoadFailed;
  const activeAccount = accountList.find((acc) => acc.id === accountId);

  const accountPanelProps = useEmailHubAccountPanel(
    accountList,
    accountId,
    setAccountId,
    setSelectedId,
    setConnectOpen,
    disconnect,
  );

  const handleRefresh = useCallback(() => {
    if (!accountId) return;
    if (isScheduledFolder) {
      void scheduled.refetch();
      return;
    }
    sync.mutate({
      accountId,
      folder: folder === "STARRED" ? undefined : mailFolder,
      force: true,
      reconcile: folder === "INBOX",
    });
  }, [accountId, folder, isScheduledFolder, mailFolder, scheduled, sync]);

  return (
    <div className="flex h-[calc(100dvh-var(--header-height,3.5rem))] min-h-0 flex-col bg-muted/20 lg:flex-row">
      <EmailHubFolderSidebar
        folder={folder}
        selectedLabel={selectedLabel}
        imapLabels={imapLabels}
        unreadCount={counts.unread}
        scheduledCount={scheduledRows.length}
        snoozedCount={snoozedCount}
        composeDisabled={!accountId}
        onFolderChange={(key) => {
          setFolder(key);
          setSelectedId(null);
        }}
        onLabelChange={setSelectedLabel}
        onCompose={() => openCompose("new")}
      />

      <EmailHubViewListPanel
        readingEmail={readingEmail}
        accountPanelProps={accountPanelProps}
        isScheduledFolder={isScheduledFolder}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        accountId={accountId}
        syncPending={sync.isPending}
        scheduledFetching={scheduled.isFetching}
        onRefresh={handleRefresh}
        unreadOnly={unreadOnly}
        onToggleUnreadOnly={() => setUnreadOnly((v) => !v)}
        hasAttachmentsOnly={hasAttachmentsOnly}
        onToggleAttachmentsOnly={() => setHasAttachmentsOnly((v) => !v)}
        counts={counts}
        threadsLoading={threads.isLoading}
        scheduledLoading={scheduled.isLoading}
        scheduledRows={scheduledRows}
        threads={threads}
        searching={searching}
        rows={rows}
        mailFolder={mailFolder}
        folderSyncing={folderSyncing}
        debouncedSearch={debouncedSearch}
        folder={folder}
        selectedId={selectedId}
        onSelectScheduled={setSelectedId}
        selectThread={selectThread}
        prefetchThread={prefetchThread}
        handleToggleStar={handleToggleStar}
        aiEnabled={aiEnabled}
        analyzingThreadId={analyzingThreadId}
        threadAiSummaries={threadAiSummaries}
        analyzeFromList={analyzeFromList}
        onNotSpamFromList={onNotSpamFromList}
      />

      <EmailHubViewDetailPanel
        readingEmail={readingEmail}
        selectedId={selectedId}
        isScheduledFolder={isScheduledFolder}
        selectedScheduled={selectedScheduled}
        accountId={accountId}
        cancelScheduledPending={cancelScheduled.isPending}
        onClearSelection={() => setSelectedId(null)}
        onCancelScheduled={() => {
          if (!accountId || !selectedScheduled) return;
          cancelScheduled.mutate(
            { accountId, scheduledId: selectedScheduled.id },
            {
              onSuccess: () => {
                toast.success(t("email_hub.scheduled.cancel_success"));
                setSelectedId(null);
              },
              onError: () => toast.error(t("email_hub.scheduled.cancel_error")),
            },
          );
        }}
        detailError={detail.isError}
        detailLoading={detail.isLoading}
        activeThread={activeThread}
        mailFolder={mailFolder}
        detailData={detail.data}
        readableBody={readableBody}
        bodyLoading={bodyLoading}
        bodyLoadFailed={bodyLoadFailed}
        starPending={toggleStar.isPending}
        movePending={moveThread.isPending}
        markReadPending={markRead.isPending}
        downloadPending={downloadAttachment.isPending}
        snoozePending={snoozeThread.isPending}
        openCompose={openCompose}
        onToggleStar={() => selectedId && activeThread && handleToggleStar(selectedId, activeThread.is_starred)}
        onMarkUnread={() => accountId && selectedId && markRead.mutate({ accountId, threadId: selectedId, isRead: false })}
        onRestoreInbox={() =>
          accountId &&
          selectedId &&
          moveThread.mutate(
            { accountId, threadId: selectedId, moveTo: "INBOX" },
            { onSuccess: () => { setFolder("INBOX"); setSelectedId(null); } },
          )
        }
        onNotSpam={() =>
          accountId &&
          selectedId &&
          moveThread.mutate(
            { accountId, threadId: selectedId, moveTo: "INBOX" },
            {
              onSuccess: () => {
                setFolder("INBOX");
                setSelectedId(null);
                toast.success(t("email_hub.not_spam_done"));
              },
            },
          )
        }
        onArchive={() =>
          accountId &&
          selectedId &&
          moveThread.mutate({ accountId, threadId: selectedId, moveTo: "ARCHIVE" }, { onSuccess: () => setSelectedId(null) })
        }
        onSpam={() =>
          accountId &&
          selectedId &&
          moveThread.mutate({ accountId, threadId: selectedId, moveTo: "SPAM" }, { onSuccess: () => setSelectedId(null) })
        }
        onClearSnooze={() =>
          accountId &&
          selectedId &&
          snoozeThread.mutate({ accountId, threadId: selectedId, clearSnooze: true }, { onSuccess: () => setSelectedId(null) })
        }
        onSnoozeTomorrow={() =>
          accountId &&
          selectedId &&
          snoozeThread.mutate(
            {
              accountId,
              threadId: selectedId,
              snoozeUntil: emailHubSnoozeToRFC3339(emailHubSnoozeTomorrowMorning()),
            },
            { onSuccess: () => setSelectedId(null) },
          )
        }
        onSnoozeNextWeek={() =>
          accountId &&
          selectedId &&
          snoozeThread.mutate(
            {
              accountId,
              threadId: selectedId,
              snoozeUntil: emailHubSnoozeToRFC3339(emailHubSnoozeNextWeekMorning()),
            },
            { onSuccess: () => setSelectedId(null) },
          )
        }
        onTrash={() =>
          accountId &&
          selectedId &&
          moveThread.mutate({ accountId, threadId: selectedId, moveTo: "TRASH" }, { onSuccess: () => setSelectedId(null) })
        }
        onRefetchDetail={() => void detail.refetch()}
        onDownloadAttachment={(att) => {
          if (!accountId || !selectedId) return;
          downloadAttachment.mutate(
            { accountId, threadId: selectedId, attachmentId: att.id },
            {
              onSuccess: (blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = att.filename || "attachment";
                a.click();
                URL.revokeObjectURL(url);
              },
            },
          );
        }}
      />

      <EmailHubStatsRail
        wsId={wsId}
        threadId={selectedId}
        threadAiSummary={selectedId ? threadAiSummaries[selectedId] : undefined}
        onThreadAiSummary={handleThreadAiSummary}
        bodyReady={readableBody || !!activeThread?.snippet || !!activeThread?.subject}
        readingEmail={readingEmail}
        counts={counts}
        activeAccount={activeAccount}
        {...accountPanelProps}
      />

      <EmailHubViewDialogs
        wsId={wsId}
        accountId={accountId}
        connectOpen={connectOpen}
        onConnectOpenChange={setConnectOpen}
        onConnected={(id) => {
          setAccountId(id);
          setSelectedId(null);
          setFolder("INBOX");
        }}
        composeOpen={composeOpen}
        onComposeOpenChange={setComposeOpen}
        composeMode={composeMode}
        composeSource={composeSource}
        onSent={(result) => {
          if (result && "scheduled" in result && result.scheduled) {
            setFolder("SCHEDULED");
            setSelectedId(null);
            return;
          }
          if (result && "id" in result) {
            setFolder("SENT");
            setSelectedId(result.id);
          }
        }}
      />
    </div>
  );
}
