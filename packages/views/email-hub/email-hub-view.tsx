"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  useDisconnectEmailHubAccount,
  useEmailHubAccounts,
  useEmailHubImapLabels,
  useEmailHubLazyFolderSync,
  useEmailHubLiveSync,
  useEmailHubScheduledSends,
  useEmailHubThread,
  useEmailHubThreads,
  useSummarizeEmailHubThread,
  useSyncEmailHub,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubAccount, EmailHubThread, EmailHubThreadSummary } from "@uniwork/core/types/email-hub";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { toastApiError } from "../toast-api-error";
import { useWorkspace } from "../layout/workspace-context";
import type { ComposeMode } from "./compose-recipients";
import { EMAIL_HUB_AI_WIDE_QUERY, EmailHubAiRail } from "./email-hub-ai-rail";
import { EmailHubConnectEmpty, EmailHubShellSkeleton } from "./email-hub-connect-empty";
import { EmailHubFolderSidebar } from "./email-hub-folder-sidebar";
import type { EmailHubFolderKey, EmailHubMailFolderKey } from "./email-hub-folders";
import { emailHubLocale, formatEmailListDate } from "./email-hub-format";
import { EmailHubSnoozeDialog } from "./email-hub-snooze-dialog";
import { EmailHubViewDetailPanel } from "./email-hub-view-detail-panel";
import { EmailHubViewDialogs } from "./email-hub-view-dialogs";
import { EmailHubViewListPanel } from "./email-hub-view-list-panel";
import { useEmailHubAccountPanel } from "./use-email-hub-account-panel";
import { useEmailHubShortcuts } from "./use-email-hub-shortcuts";
import { useEmailHubThreadActions } from "./use-email-hub-thread-actions";

export function EmailHubView() {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const { workspace } = useWorkspace();
  const wsId = workspace.id;
  const qc = useQueryClient();
  const accounts = useEmailHubAccounts(wsId);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folder, setFolderState] = useState<EmailHubFolderKey>("INBOX");
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [hasAttachmentsOnly, setHasAttachmentsOnly] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [connectOpen, setConnectOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [composeSource, setComposeSource] = useState<EmailHubThread | null>(null);
  const [aiRailOpen, setAiRailOpen] = useState(true);
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
  const wideAi = useMediaQuery(EMAIL_HUB_AI_WIDE_QUERY);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastOpenedRef = useRef<string | null>(null);
  if (selectedId) lastOpenedRef.current = selectedId;

  const setFolder = useCallback((next: EmailHubFolderKey) => {
    setFolderState(next);
    setSelectedId(null);
    setCheckedIds(new Set());
  }, []);

  const imapLabelsQuery = useEmailHubImapLabels(wsId, accountId);
  const imapLabels = useMemo(() => imapLabelsQuery.data?.labels ?? [], [imapLabelsQuery.data?.labels]);
  const sync = useSyncEmailHub(wsId);
  const disconnect = useDisconnectEmailHubAccount(wsId);
  const summarizeThread = useSummarizeEmailHubThread(wsId);
  const cancelScheduled = useCancelEmailHubScheduledSend(wsId);
  const { data: aiCaps } = useAiCapabilities(wsId);
  const aiEnabled = !!aiCaps?.enabled;
  const [threadAiSummaries, setThreadAiSummaries] = useState<Record<string, EmailHubThreadSummary>>({});
  const [analyzingThreadId, setAnalyzingThreadId] = useState<string | null>(null);

  const isScheduledFolder = folder === "SCHEDULED";
  const mailFolder: EmailHubMailFolderKey = isScheduledFolder ? "INBOX" : folder;
  const scheduled = useEmailHubScheduledSends(wsId, accountId);
  const readingEmail = !!selectedId;
  useEmailHubLiveSync(wsId, accountId, folder === "INBOX" || folder === "STARRED", readingEmail && !isScheduledFolder);
  const snoozedMeta = useEmailHubThreads(wsId, accountId, "SNOOZED", {}, !!accountId, {
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  const inboxMeta = useEmailHubThreads(wsId, accountId, "INBOX", {}, !!accountId && folder !== "INBOX", {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const accountList = useMemo(() => {
    const byEmail = new Map<string, EmailHubAccount>();
    for (const acc of accounts.data?.accounts ?? []) byEmail.set(acc.email_address, acc);
    return [...byEmail.values()];
  }, [accounts.data]);

  useEffect(() => {
    const latest = accountList.at(-1)?.id;
    if (latest && !accountId) setAccountId(latest);
  }, [accountList, accountId]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    setCheckedIds(new Set());
  }, [accountId, debouncedSearch, unreadOnly, hasAttachmentsOnly, selectedLabel]);

  useEffect(() => {
    if (!accountId) return;
    setEmailHubListRefreshPaused(wsId, accountId, readingEmail);
    if (!readingEmail) flushEmailHubListRefresh(qc, wsId, accountId);
  }, [accountId, qc, readingEmail, wsId]);

  const filters = useMemo(
    () => ({ q: debouncedSearch || undefined, label: selectedLabel || undefined, unreadOnly, hasAttachmentsOnly }),
    [debouncedSearch, selectedLabel, unreadOnly, hasAttachmentsOnly],
  );
  const threads = useEmailHubThreads(wsId, accountId, mailFolder, filters, !isScheduledFolder);
  const lazyMailFolder = isScheduledFolder || folder === "STARRED" || folder === "SNOOZED" ? "" : mailFolder;
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
  }, [accountId, debouncedSearch, hasAttachmentsOnly, isScheduledFolder, qc, rows, selectedId, threads.isFetched, threads.isFetching, unreadOnly, wsId]);

  useEffect(() => {
    if (!accountId || rows.length === 0) return;
    for (const row of rows.slice(0, 5)) {
      if (row.id !== selectedId) prefetchEmailHubThread(qc, wsId, accountId, row.id);
    }
  }, [accountId, rows, qc, wsId, selectedId]);

  const openCompose = useCallback((mode: ComposeMode, source?: EmailHubThread | null) => {
    setComposeMode(mode);
    setComposeSource(source ?? null);
    setComposeOpen(true);
  }, []);

  const activeThread =
    detail.data?.id === selectedId ? detail.data : selectedRow?.id === selectedId ? selectedRow : null;
  const readableBody = emailHubHasReadableBody(detail.data);
  const activeAccount = accountList.find((acc) => acc.id === accountId);
  const aiOpen = wideAi ? aiRailOpen : aiSheetOpen;
  const toggleAi = useCallback(
    () => (wideAi ? setAiRailOpen((v) => !v) : setAiSheetOpen((v) => !v)),
    [wideAi],
  );

  const threadActions = useEmailHubThreadActions({
    wsId,
    accountId,
    selectedId,
    activeThread,
    detailData: detail.data,
    setSelectedId,
    setFolder,
    openCompose,
    onToggleAi: toggleAi,
    refetchDetail: () => void detail.refetch(),
  });

  const selectThread = useCallback(
    (threadId: string) => {
      setSelectedId(threadId);
      if (!accountId) return;
      void qc.cancelQueries({ queryKey: emailHubKeys.thread(wsId, accountId, threadId) });
      const row = rows.find((item) => item.id === threadId);
      if (row && !row.is_read) threadActions.setRead(threadId, true);
    },
    [accountId, qc, rows, threadActions, wsId],
  );

  const analyzeFromList = useCallback(
    (threadId: string) => {
      if (!accountId || !aiEnabled) return;
      setAnalyzingThreadId(threadId);
      summarizeThread.mutate(
        { accountId, threadId, locale: locale === "en-US" ? "en" : "vi" },
        {
          onSuccess: (data) => {
            if (data.summary) setThreadAiSummaries((prev) => ({ ...prev, [threadId]: data }));
          },
          onError: (err) => {
            if (errorCode(err) === "nothing_to_summarize") toast.error(t("email_hub.ai.nothing_to_summarize"));
            else toastApiError(err, t("email_hub.ai.summarize_error"));
          },
          onSettled: () => setAnalyzingThreadId(null),
        },
      );
    },
    [accountId, aiEnabled, locale, summarizeThread, t],
  );

  const handleThreadAiSummary = useCallback(
    (data: EmailHubThreadSummary) => {
      if (!selectedId) return;
      setThreadAiSummaries((prev) => {
        const cur = prev[selectedId];
        if (cur?.summary === data.summary && cur?.cached === data.cached && cur?.summarized_at === data.summarized_at) {
          return prev;
        }
        return { ...prev, [selectedId]: data };
      });
    },
    [selectedId],
  );

  const accountMenu = useEmailHubAccountPanel(
    accountList,
    accountId,
    setAccountId,
    setSelectedId,
    setConnectOpen,
    disconnect,
    useCallback((err: unknown) => toastApiError(err, t("email_hub.disconnect_error")), [t]),
  );

  const handleRefresh = useCallback(() => {
    if (!accountId) return;
    if (isScheduledFolder) {
      void scheduled.refetch();
      return;
    }
    sync.mutate(
      { accountId, folder: folder === "STARRED" ? undefined : mailFolder, force: true, reconcile: folder === "INBOX" },
      { onError: (err) => toastApiError(err, t("email_hub.sync_error")) },
    );
  }, [accountId, folder, isScheduledFolder, mailFolder, scheduled, sync, t]);

  const stepThread = (step: 1 | -1) => {
    const index = rows.findIndex((row) => row.id === selectedId);
    const next = index === -1 ? undefined : rows[index + step];
    if (next) selectThread(next.id);
  };
  const { actions } = threadActions;
  useEmailHubShortcuts({
    reading: readingEmail && !isScheduledFolder,
    onCompose: accountId ? () => openCompose("new") : undefined,
    onFocusSearch: () => searchRef.current?.focus(),
    onBack: actions.onBack,
    onNext: () => stepThread(1),
    onPrev: () => stepThread(-1),
    onArchive: activeThread?.folder === "INBOX" ? actions.onArchive : undefined,
    onTrash: activeThread?.folder === "INBOX" || activeThread?.folder === "SENT" ? actions.onTrash : undefined,
    onReply: actions.onReply,
    onReplyAll: actions.onReplyAll,
    onForward: actions.onForward,
    onStar: actions.onToggleStar,
    onMarkUnread: activeThread?.folder === "INBOX" ? actions.onMarkUnread : undefined,
  });

  const counts = threads.data?.pages[0]?.counts ?? { total: 0, unread: 0 };
  const inboxUnread = folder === "INBOX" ? counts.unread : (inboxMeta.data?.pages[0]?.counts.unread ?? 0);
  const nav = {
    folder,
    selectedLabel,
    imapLabels,
    counts: {
      inboxUnread,
      scheduled: scheduledRows.length,
      snoozed: snoozedMeta.data?.pages[0]?.counts.total ?? 0,
    },
    onFolderChange: setFolder,
    onLabelChange: setSelectedLabel,
  };
  const checkedList = rows.filter((row) => checkedIds.has(row.id)).map((row) => row.id);
  const clearChecked = () => setCheckedIds(new Set());
  const dialogs = (
    <EmailHubViewDialogs
      wsId={wsId}
      accountId={accountId}
      connectOpen={connectOpen}
      onConnectOpenChange={setConnectOpen}
      onConnected={(id) => {
        setAccountId(id);
        setFolder("INBOX");
      }}
      composeOpen={composeOpen}
      onComposeOpenChange={setComposeOpen}
      composeMode={composeMode}
      composeSource={composeSource}
      onOpenScheduled={() => setFolder("SCHEDULED")}
    />
  );
  const frame = "flex h-[calc(100dvh-var(--header-height,3.5rem))] min-h-0 bg-background";

  if (accounts.isLoading) {
    return (
      <div className={frame}>
        <EmailHubShellSkeleton />
      </div>
    );
  }
  if (accountList.length === 0) {
    return (
      <div className={frame}>
        <EmailHubConnectEmpty aiEnabled={aiEnabled} onConnect={() => setConnectOpen(true)} />
        {dialogs}
      </div>
    );
  }

  return (
    <div className={frame}>
      <EmailHubFolderSidebar
        {...nav}
        composeDisabled={!accountId}
        onCompose={() => openCompose("new")}
        accountMenu={accountMenu}
      />

      {readingEmail ? (
        <EmailHubViewDetailPanel
          isScheduledFolder={isScheduledFolder}
          selectedScheduled={selectedScheduled}
          cancelScheduledPending={cancelScheduled.isPending}
          onCancelScheduled={(onDone) => {
            if (!accountId || !selectedScheduled) return;
            cancelScheduled.mutate(
              { accountId, scheduledId: selectedScheduled.id },
              {
                onSuccess: () => {
                  toast.success(t("email_hub.scheduled.cancel_success"));
                  setSelectedId(null);
                },
                onError: (err) => toastApiError(err, t("email_hub.scheduled.cancel_error")),
                onSettled: onDone,
              },
            );
          }}
          detailError={detail.isError}
          detailLoading={detail.isLoading}
          activeThread={activeThread}
          mailFolder={mailFolder}
          detailData={detail.data}
          readableBody={readableBody}
          bodyLoading={detail.isBodyLoading}
          bodyLoadFailed={detail.isBodyLoadFailed}
          actions={actions}
          pending={threadActions.pending}
          aiOpen={aiOpen}
        />
      ) : (
        <EmailHubViewListPanel
          returnFocusId={lastOpenedRef.current}
          header={{
            nav,
            accountMenu,
            isScheduledFolder,
            searchInput,
            onSearchInputChange: setSearchInput,
            refreshDisabled: !accountId || (isScheduledFolder ? scheduled.isFetching : sync.isPending),
            refreshing: isScheduledFolder ? scheduled.isFetching : sync.isPending,
            onRefresh: handleRefresh,
            unreadOnly,
            onToggleUnreadOnly: () => setUnreadOnly((v) => !v),
            hasAttachmentsOnly,
            onToggleAttachmentsOnly: () => setHasAttachmentsOnly((v) => !v),
            countText: isScheduledFolder
              ? scheduled.isLoading
                ? null
                : t("email_hub.scheduled.list_count", { count: scheduledRows.length })
              : threads.isLoading
                ? null
                : t("email_hub.list_count", { count: counts.total, unread: counts.unread }),
            lastSyncText: activeAccount?.last_sync_at
              ? t("email_hub.last_sync", { when: formatEmailListDate(activeAccount.last_sync_at, locale) })
              : null,
            composeDisabled: !accountId,
            onCompose: () => openCompose("new"),
            searchRef,
            bulk: isScheduledFolder
              ? null
              : {
                  count: checkedList.length,
                  allChecked: checkedList.length === rows.length,
                  onToggleAll: (all) => setCheckedIds(all ? new Set(rows.map((row) => row.id)) : new Set()),
                  onClear: clearChecked,
                  onMarkRead: (read) => void threadActions.bulkRead(checkedList, read).then(clearChecked),
                  onArchive:
                    mailFolder === "INBOX"
                      ? () => void threadActions.bulkMove(checkedList, "ARCHIVE").then(clearChecked)
                      : undefined,
                  onTrash:
                    mailFolder === "INBOX" || mailFolder === "SENT"
                      ? () => void threadActions.bulkMove(checkedList, "TRASH").then(clearChecked)
                      : undefined,
                  pending: threadActions.bulkPending,
                },
          }}
          state={{
            folder,
            mailFolder,
            isScheduledFolder,
            loading: isScheduledFolder ? scheduled.isLoading : threads.isLoading,
            error: threads.isError,
            onRetry: () => void threads.refetch(),
            syncing: folderSyncing || sync.isPending || threads.isFetching,
            searching: !!debouncedSearch && threads.isFetching && !threads.isFetchingNextPage,
            searchQuery: debouncedSearch,
            filtersActive: unreadOnly || hasAttachmentsOnly || !!selectedLabel,
            onClearSearch: () => setSearchInput(""),
            onClearFilters: () => {
              setUnreadOnly(false);
              setHasAttachmentsOnly(false);
              setSelectedLabel(null);
            },
            rows,
            scheduledRows,
            hasNextPage: !!threads.hasNextPage,
            fetchingNextPage: threads.isFetchingNextPage,
            onLoadMore: () => {
              if (threads.hasNextPage && !threads.isFetchingNextPage) void threads.fetchNextPage();
            },
          }}
          handlers={{
            checkedIds,
            onCheckedChange: (id, checked) =>
              setCheckedIds((prev) => {
                const next = new Set(prev);
                if (checked) next.add(id);
                else next.delete(id);
                return next;
              }),
            onSelectThread: selectThread,
            onSelectScheduled: setSelectedId,
            onPrefetch: (id) => {
              if (accountId && id !== selectedId) prefetchEmailHubThread(qc, wsId, accountId, id);
            },
            onToggleStar: threadActions.star,
            aiEnabled,
            analyzingThreadId,
            threadAiSummaries,
            onAnalyze: analyzeFromList,
            onNotSpam: (id) => threadActions.move(id, "INBOX"),
          }}
        />
      )}

      {readingEmail && !isScheduledFolder && selectedId && accountId ? (
        <EmailHubAiRail
          wide={wideAi}
          open={aiOpen}
          onOpenChange={wideAi ? setAiRailOpen : setAiSheetOpen}
          wsId={wsId}
          accountId={accountId}
          threadId={selectedId}
          bodyReady={readableBody || !!activeThread?.snippet || !!activeThread?.subject}
          initialSummary={threadAiSummaries[selectedId]}
          onSummaryChange={handleThreadAiSummary}
        />
      ) : null}

      <EmailHubSnoozeDialog {...threadActions.snoozeDialog} />
      {dialogs}
    </div>
  );
}
