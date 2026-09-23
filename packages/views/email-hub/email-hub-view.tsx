"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MailOpen, Paperclip, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  emailHubHasReadableBody,
  emailHubKeys,
  flushEmailHubListRefresh,
  prefetchEmailHubThread,
  setEmailHubListRefreshPaused,
  useCancelEmailHubScheduledSend,
  useEmailHubAccounts,
  useEmailHubScheduledSends,
  useEmailHubThread,
  useEmailHubThreads,
  useDownloadEmailHubAttachment,
  useDisconnectEmailHubAccount,
  useEmailHubLiveSync,
  useMarkEmailHubRead,
  useMoveEmailHubThread,
  useSyncEmailHub,
  useToggleEmailHubStar,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { ComposeEmailDialog } from "./compose-email-dialog";
import type { ComposeMode } from "./compose-recipients";
import { ConnectAccountDialog } from "./connect-account-dialog";
import { EmailHubAccountsPanel } from "./email-hub-accounts-panel";
import { EmailHubFolderSidebar, type EmailHubFolderKey } from "./email-hub-folder-sidebar";
import { useEmailHubAccountPanel } from "./use-email-hub-account-panel";
import { EmailHubScheduledDetail } from "./email-hub-scheduled-detail";
import { EmailHubScheduledListItem } from "./email-hub-scheduled-list-item";
import { EmailHubStatsRail } from "./email-hub-stats-rail";
import { EmailHubThreadDetail } from "./email-hub-thread-detail";
import { EmailHubThreadListItem } from "./email-hub-thread-list-item";
import { emailHubFilterChipClass } from "./email-hub-ui";
import { EmptyPanel } from "./email-hub-view-parts";

type FolderKey = EmailHubFolderKey;
type MailFolderKey = Exclude<FolderKey, "SCHEDULED">;

export function EmailHubView() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const wsId = workspace.id;
  const qc = useQueryClient();
  const accounts = useEmailHubAccounts(wsId);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderKey>("INBOX");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [hasAttachmentsOnly, setHasAttachmentsOnly] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [composeSource, setComposeSource] = useState<EmailHubThread | null>(null);
  const sync = useSyncEmailHub(wsId);
  const disconnect = useDisconnectEmailHubAccount(wsId);
  const moveThread = useMoveEmailHubThread(wsId);
  const toggleStar = useToggleEmailHubStar(wsId);
  const markRead = useMarkEmailHubRead(wsId);
  const downloadAttachment = useDownloadEmailHubAttachment(wsId);
  const isScheduledFolder = folder === "SCHEDULED";
  const mailFolder: MailFolderKey = isScheduledFolder ? "INBOX" : folder;
  const scheduled = useEmailHubScheduledSends(wsId, accountId);
  const cancelScheduled = useCancelEmailHubScheduledSend(wsId);
  const readingEmail = !!selectedId;
  useEmailHubLiveSync(wsId, accountId, folder === "INBOX" || folder === "STARRED", readingEmail && !isScheduledFolder);

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
      unreadOnly,
      hasAttachmentsOnly,
    }),
    [debouncedSearch, unreadOnly, hasAttachmentsOnly],
  );
  const threads = useEmailHubThreads(wsId, accountId, mailFolder, filters, !isScheduledFolder);
  const scheduledRows = useMemo(
    () => scheduled.data?.scheduled ?? [],
    [scheduled.data?.scheduled],
  );
  const selectedScheduled = useMemo(
    () => scheduledRows.find((row) => row.id === selectedId) ?? null,
    [scheduledRows, selectedId],
  );
  const rows = useMemo(
    () => threads.data?.pages.flatMap((page) => page.threads) ?? [],
    [threads.data],
  );
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

  return (
    <div className="flex h-[calc(100dvh-var(--header-height,3.5rem))] min-h-0 flex-col bg-muted/20 lg:flex-row">
      <EmailHubFolderSidebar
        folder={folder}
        unreadCount={counts.unread}
        scheduledCount={scheduledRows.length}
        composeDisabled={!accountId}
        onFolderChange={(key) => {
          setFolder(key);
          setSelectedId(null);
        }}
        onCompose={() => openCompose("new")}
      />

      <section
        className={cn(
          "flex w-full min-w-0 flex-col border-b border-border bg-background lg:w-72 lg:max-w-[32%] lg:border-b-0 lg:border-r xl:w-80",
          readingEmail && "hidden",
        )}
      >
        <div className="space-y-3 border-b border-border p-3">
          <div className="border-b border-border pb-3 lg:hidden">
            <EmailHubAccountsPanel {...accountPanelProps} />
          </div>
          <div className="flex items-center gap-2">
            {!isScheduledFolder ? (
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t("email_hub.search_placeholder")}
                  className="h-10 rounded-lg pl-9"
                />
              </div>
            ) : (
              <p className="min-w-0 flex-1 px-1 text-body font-medium">{t("email_hub.folders.scheduled")}</p>
            )}
            <Button
              variant="toolbar"
              size="icon"
              className="size-10 shrink-0 rounded-xl shadow-none"
              disabled={!accountId || (isScheduledFolder ? scheduled.isFetching : sync.isPending)}
              aria-label={t("email_hub.refresh")}
              onClick={() => {
                if (!accountId) return;
                if (isScheduledFolder) {
                  void scheduled.refetch();
                  return;
                }
                sync.mutate({
                  accountId,
                  folder: folder === "STARRED" ? undefined : mailFolder,
                  force: true,
                  reconcile: true,
                });
              }}
            >
              <RefreshCw
                className={cn(
                  "size-4",
                  (isScheduledFolder ? scheduled.isFetching : sync.isPending) && "animate-spin",
                )}
              />
            </Button>
          </div>
          {!isScheduledFolder ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={emailHubFilterChipClass(unreadOnly)}
                onClick={() => setUnreadOnly((v) => !v)}
              >
                {t("email_hub.filters.unread")}
              </button>
              <button
                type="button"
                className={emailHubFilterChipClass(hasAttachmentsOnly)}
                onClick={() => setHasAttachmentsOnly((v) => !v)}
              >
                <Paperclip className="size-3.5" aria-hidden />
                {t("email_hub.filters.attachments")}
              </button>
            </div>
          ) : null}
          {accountId && !isScheduledFolder && !threads.isLoading ? (
            <p className="text-caption text-muted-foreground">
              {t("email_hub.list_count", { count: counts.total, unread: counts.unread })}
            </p>
          ) : null}
          {accountId && isScheduledFolder && !scheduled.isLoading ? (
            <p className="text-caption text-muted-foreground">
              {t("email_hub.scheduled.list_count", { count: scheduledRows.length })}
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {!accountId ? (
            <EmptyPanel message={t("email_hub.connect_prompt")} />
          ) : isScheduledFolder ? (
            scheduled.isLoading && scheduledRows.length === 0 ? (
              <div className="space-y-2 px-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
                ))}
              </div>
            ) : scheduledRows.length === 0 ? (
              <EmptyPanel message={t("email_hub.scheduled.empty")} />
            ) : (
              <ul className="space-y-1">
                {scheduledRows.map((row) => (
                  <EmailHubScheduledListItem
                    key={row.id}
                    row={row}
                    selected={selectedId === row.id}
                    onSelect={() => setSelectedId(row.id)}
                  />
                ))}
              </ul>
            )
          ) : (threads.isLoading || searching) && rows.length === 0 ? (
            <div className="space-y-2 px-3">
              {searching ? (
                <p className="px-1 py-2 text-body text-muted-foreground">{t("email_hub.search_loading")}</p>
              ) : null}
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyPanel
              message={debouncedSearch ? t("email_hub.search_empty") : t("email_hub.empty_list")}
            />
          ) : (
            <ul className="space-y-1">
              {rows.map((row) => (
                <EmailHubThreadListItem
                  key={row.id}
                  row={row}
                  selected={selectedId === row.id}
                  onSelect={() => selectThread(row.id)}
                  onPrefetch={() => prefetchThread(row.id)}
                  onToggleStar={() => handleToggleStar(row.id, row.is_starred)}
                />
              ))}
            </ul>
          )}
          {!isScheduledFolder && threads.hasNextPage && folder !== "STARRED" ? (
            <div className="p-3">
              <Button
                variant="toolbar"
                className="h-10 w-full rounded-xl shadow-none"
                disabled={threads.isFetchingNextPage}
                onClick={() => threads.fetchNextPage()}
              >
                {threads.isFetchingNextPage ? t("email_hub.load_more_loading") : t("email_hub.load_more")}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <section
        className={cn(
          "min-w-0 flex-1 bg-background lg:min-h-0",
          readingEmail
            ? "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden"
            : "hidden min-h-[240px] overflow-y-auto p-3 lg:block lg:p-5",
        )}
      >
        {!selectedId ? (
          <EmptyPanel message={t("email_hub.empty_detail")} icon={MailOpen} />
        ) : isScheduledFolder && selectedScheduled && accountId ? (
          <EmailHubScheduledDetail
            item={selectedScheduled}
            cancelPending={cancelScheduled.isPending}
            onBack={() => setSelectedId(null)}
            onCancel={() => {
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
          />
        ) : detail.isError && !activeThread ? (
          <EmptyPanel message={t("email_hub.load_error")} />
        ) : !activeThread && detail.isLoading ? (
          <div className="space-y-4 px-4 py-4 lg:px-6">
            <Skeleton className="h-8 w-2/3 rounded-lg" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : activeThread && accountId && selectedId ? (
          <EmailHubThreadDetail
            activeThread={activeThread}
            accountId={accountId}
            selectedId={selectedId}
            detailData={detail.data}
            readableBody={readableBody}
            bodyLoading={bodyLoading}
            bodyLoadFailed={bodyLoadFailed}
            isError={detail.isError}
            starPending={toggleStar.isPending}
            movePending={moveThread.isPending}
            markReadPending={markRead.isPending}
            downloadPending={downloadAttachment.isPending}
            onBack={() => setSelectedId(null)}
            onToggleStar={() => handleToggleStar(selectedId, activeThread.is_starred)}
            onReply={() => openCompose("reply", detail.data ?? activeThread)}
            onReplyAll={() => openCompose("replyAll", detail.data ?? activeThread)}
            onForward={() => openCompose("forward", detail.data ?? activeThread)}
            onMarkUnread={() => {
              markRead.mutate({ accountId, threadId: selectedId, isRead: false });
            }}
            onRestoreInbox={() => {
              moveThread.mutate(
                { accountId, threadId: selectedId, moveTo: "INBOX" },
                { onSuccess: () => { setFolder("INBOX"); setSelectedId(null); } },
              );
            }}
            onArchive={() => {
              moveThread.mutate(
                { accountId, threadId: selectedId, moveTo: "ARCHIVE" },
                { onSuccess: () => setSelectedId(null) },
              );
            }}
            onTrash={() => {
              moveThread.mutate(
                { accountId, threadId: selectedId, moveTo: "TRASH" },
                { onSuccess: () => setSelectedId(null) },
              );
            }}
            onRefetch={() => void detail.refetch()}
            onDownloadAttachment={(att) => {
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
        ) : (
          <EmptyPanel message={t("email_hub.load_error")} />
        )}
      </section>

      <EmailHubStatsRail readingEmail={readingEmail} counts={counts} activeAccount={activeAccount} {...accountPanelProps} />

      <ConnectAccountDialog
        wsId={wsId}
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={(id) => {
          setAccountId(id);
          setSelectedId(null);
          setFolder("INBOX");
        }}
      />
      <ComposeEmailDialog
        wsId={wsId}
        accountId={accountId}
        open={composeOpen}
        onOpenChange={setComposeOpen}
        mode={composeMode}
        sourceThread={composeSource}
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
