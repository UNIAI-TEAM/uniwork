"use client";

import { Paperclip, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { emailHubLazySyncShowsSyncing } from "@uniwork/core/email-hub/hooks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import { EmailHubAccountsPanel } from "./email-hub-accounts-panel";
import type { useEmailHubAccountPanel } from "./use-email-hub-account-panel";
import { EmailHubScheduledListItem } from "./email-hub-scheduled-list-item";
import { EmailHubThreadListItem } from "./email-hub-thread-list-item";
import { emailHubFilterChipClass } from "./email-hub-ui";
import { EmptyPanel } from "./email-hub-view-parts";
import type { EmailHubFolderKey } from "./email-hub-folder-sidebar";

type MailFolderKey = Exclude<EmailHubFolderKey, "SCHEDULED">;

type ListPage = {
  threads: EmailHubThread[];
  counts: { total: number; unread: number };
};

export type EmailHubViewListPanelProps = {
  readingEmail: boolean;
  accountPanelProps: ReturnType<typeof useEmailHubAccountPanel>;
  isScheduledFolder: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  accountId: string | null;
  syncPending: boolean;
  scheduledFetching: boolean;
  onRefresh: () => void;
  unreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  hasAttachmentsOnly: boolean;
  onToggleAttachmentsOnly: () => void;
  counts: { total: number; unread: number };
  threadsLoading: boolean;
  scheduledLoading: boolean;
  scheduledRows: EmailHubScheduledSendItem[];
  threads: UseInfiniteQueryResult<InfiniteData<ListPage>>;
  searching: boolean;
  rows: EmailHubThread[];
  mailFolder: MailFolderKey;
  folderSyncing: boolean;
  debouncedSearch: string;
  folder: EmailHubFolderKey;
  selectedId: string | null;
  onSelectScheduled: (id: string) => void;
  selectThread: (id: string) => void;
  prefetchThread: (id: string) => void;
  handleToggleStar: (threadId: string, isStarred: boolean) => void;
  aiEnabled: boolean;
  analyzingThreadId: string | null;
  threadAiSummaries: Record<string, { summary?: string }>;
  analyzeFromList: (threadId: string) => void;
  onNotSpamFromList: (threadId: string) => void;
};

export function EmailHubViewListPanel(props: EmailHubViewListPanelProps) {
  const { t } = useTranslation();
  const {
    readingEmail,
    accountPanelProps,
    isScheduledFolder,
    searchInput,
    onSearchInputChange,
    accountId,
    syncPending,
    scheduledFetching,
    onRefresh,
    unreadOnly,
    onToggleUnreadOnly,
    hasAttachmentsOnly,
    onToggleAttachmentsOnly,
    counts,
    threadsLoading,
    scheduledLoading,
    scheduledRows,
    threads,
    searching,
    rows,
    mailFolder,
    folderSyncing,
    debouncedSearch,
    folder,
    selectedId,
    onSelectScheduled,
    selectThread,
    prefetchThread,
    handleToggleStar,
    aiEnabled,
    analyzingThreadId,
    threadAiSummaries,
    analyzeFromList,
    onNotSpamFromList,
  } = props;

  return (
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
                onChange={(e) => onSearchInputChange(e.target.value)}
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
            disabled={!accountId || (isScheduledFolder ? scheduledFetching : syncPending)}
            aria-label={t("email_hub.refresh")}
            onClick={onRefresh}
          >
            <RefreshCw
              className={cn("size-4", (isScheduledFolder ? scheduledFetching : syncPending) && "animate-spin")}
            />
          </Button>
        </div>
        {!isScheduledFolder ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={emailHubFilterChipClass(unreadOnly)} onClick={onToggleUnreadOnly}>
              {t("email_hub.filters.unread")}
            </button>
            <button
              type="button"
              className={emailHubFilterChipClass(hasAttachmentsOnly)}
              onClick={onToggleAttachmentsOnly}
            >
              <Paperclip className="size-3.5" aria-hidden />
              {t("email_hub.filters.attachments")}
            </button>
          </div>
        ) : null}
        {accountId && !isScheduledFolder && !threadsLoading ? (
          <p className="text-caption text-muted-foreground">
            {t("email_hub.list_count", { count: counts.total, unread: counts.unread })}
          </p>
        ) : null}
        {accountId && isScheduledFolder && !scheduledLoading ? (
          <p className="text-caption text-muted-foreground">
            {t("email_hub.scheduled.list_count", { count: scheduledRows.length })}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {!accountId ? (
          <EmptyPanel message={t("email_hub.connect_prompt")} />
        ) : isScheduledFolder ? (
          scheduledLoading && scheduledRows.length === 0 ? (
            <div className="space-y-2 px-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[4.75rem] w-full rounded-xl" />
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
                  onSelect={() => onSelectScheduled(row.id)}
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
              <Skeleton key={i} className="h-[4.75rem] w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 &&
          emailHubLazySyncShowsSyncing(mailFolder) &&
          (folderSyncing || syncPending || threads.isFetching) ? (
          <EmptyPanel
            message={mailFolder === "SPAM" ? t("email_hub.spam.syncing") : t("email_hub.folder_syncing")}
          />
        ) : rows.length === 0 ? (
          <EmptyPanel
            message={
              debouncedSearch
                ? t("email_hub.search_empty")
                : mailFolder === "SPAM"
                  ? t("email_hub.spam.empty")
                  : t("email_hub.empty_list")
            }
          />
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => (
              <EmailHubThreadListItem
                key={row.id}
                row={row}
                listFolder={mailFolder}
                selected={selectedId === row.id}
                onSelect={() => selectThread(row.id)}
                onPrefetch={() => prefetchThread(row.id)}
                onToggleStar={() => handleToggleStar(row.id, row.is_starred)}
                aiEnabled={aiEnabled}
                analyzing={analyzingThreadId === row.id}
                listSummary={threadAiSummaries[row.id]?.summary}
                onAnalyze={() => analyzeFromList(row.id)}
                onNotSpam={
                  mailFolder === "SPAM" && accountId ? () => onNotSpamFromList(row.id) : undefined
                }
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
  );
}
