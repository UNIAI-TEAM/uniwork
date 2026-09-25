"use client";

import { useEffect, useRef } from "react";
import { CalendarClock, Inbox, RefreshCw, SearchX, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { emailHubEmptyFolderKey, type EmailHubFolderKey, type EmailHubMailFolderKey } from "./email-hub-folders";
import { EmailHubListHeader, type EmailHubListHeaderProps } from "./email-hub-list-header";
import { EmailHubScheduledListItem } from "./email-hub-scheduled-list-item";
import { EmailHubThreadListItem } from "./email-hub-thread-list-item";
import { EmailHubEmptyState } from "./email-hub-view-parts";

export interface EmailHubListBodyState {
  folder: EmailHubFolderKey;
  mailFolder: EmailHubMailFolderKey;
  isScheduledFolder: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  syncing: boolean;
  searching: boolean;
  searchQuery: string;
  filtersActive: boolean;
  onClearSearch: () => void;
  onClearFilters: () => void;
  rows: EmailHubThread[];
  scheduledRows: EmailHubScheduledSendItem[];
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  onLoadMore: () => void;
}

export interface EmailHubListRowHandlers {
  checkedIds: ReadonlySet<string>;
  onCheckedChange: (id: string, checked: boolean) => void;
  onSelectThread: (id: string) => void;
  onSelectScheduled: (id: string) => void;
  onPrefetch: (id: string) => void;
  onToggleStar: (id: string, isStarred: boolean) => void;
  aiEnabled: boolean;
  analyzingThreadId: string | null;
  threadAiSummaries: Record<string, { summary?: string }>;
  onAnalyze: (id: string) => void;
  onNotSpam: (id: string) => void;
}

function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 border-b border-border/70 px-3 py-3 lg:px-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <Skeleton className="h-3 w-12 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/** Loads the next page as the end of the list scrolls into view; the button stays for keyboards. */
function LoadMore({ fetching, onLoadMore }: { fetching: boolean; onLoadMore: () => void }) {
  const { t } = useTranslation();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef(onLoadMore);
  useEffect(() => {
    loadRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadRef.current();
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sentinelRef} className="flex justify-center p-3">
      <Button type="button" variant="ghost" size="sm" disabled={fetching} onClick={onLoadMore}>
        {fetching ? <Spinner className="size-3.5" /> : null}
        {fetching ? t("email_hub.load_more_loading") : t("email_hub.load_more")}
      </Button>
    </div>
  );
}

function ListBody({ state, handlers }: { state: EmailHubListBodyState; handlers: EmailHubListRowHandlers }) {
  const { t } = useTranslation();
  const selectionMode = handlers.checkedIds.size > 0;

  if (state.isScheduledFolder) {
    if (state.loading && state.scheduledRows.length === 0) return <ListSkeleton rows={4} />;
    if (state.scheduledRows.length === 0) {
      return <EmailHubEmptyState icon={CalendarClock} message={t(emailHubEmptyFolderKey("SCHEDULED"))} />;
    }
    return (
      <ul>
        {state.scheduledRows.map((row) => (
          <EmailHubScheduledListItem key={row.id} row={row} onSelect={() => handlers.onSelectScheduled(row.id)} />
        ))}
      </ul>
    );
  }

  if ((state.loading || state.searching) && state.rows.length === 0) {
    return (
      <div aria-busy="true">
        {state.searching ? (
          <p className="px-4 pt-3 text-caption text-muted-foreground" role="status">
            {t("email_hub.search_loading")}
          </p>
        ) : null}
        <ListSkeleton />
      </div>
    );
  }

  if (state.error && state.rows.length === 0) {
    return (
      <EmailHubEmptyState
        icon={TriangleAlert}
        title={t("email_hub.list_error_title")}
        message={t("email_hub.list_error")}
        action={
          <Button type="button" variant="outline" onClick={state.onRetry}>
            <RefreshCw aria-hidden />
            {t("common.retry")}
          </Button>
        }
      />
    );
  }

  if (state.rows.length === 0) {
    if (state.syncing) {
      return (
        <EmailHubEmptyState
          icon={RefreshCw}
          message={state.mailFolder === "SPAM" ? t("email_hub.spam.syncing") : t("email_hub.folder_syncing")}
        />
      );
    }
    if (state.searchQuery) {
      return (
        <EmailHubEmptyState
          icon={SearchX}
          title={t("email_hub.search_empty_title", { query: state.searchQuery })}
          message={t("email_hub.search_empty")}
          action={
            <Button type="button" variant="outline" onClick={state.onClearSearch}>
              {t("email_hub.search_clear")}
            </Button>
          }
        />
      );
    }
    if (state.filtersActive) {
      return (
        <EmailHubEmptyState
          icon={SearchX}
          message={t("email_hub.filters_empty")}
          action={
            <Button type="button" variant="outline" onClick={state.onClearFilters}>
              {t("email_hub.filters.clear")}
            </Button>
          }
        />
      );
    }
    return <EmailHubEmptyState icon={Inbox} message={t(emailHubEmptyFolderKey(state.folder))} />;
  }

  return (
    <>
      <ul aria-label={t("email_hub.list_label")}>
        {state.rows.map((row) => (
          <EmailHubThreadListItem
            key={row.id}
            row={row}
            listFolder={state.mailFolder}
            checked={handlers.checkedIds.has(row.id)}
            selectionMode={selectionMode}
            onCheckedChange={(checked) => handlers.onCheckedChange(row.id, checked)}
            onSelect={() => handlers.onSelectThread(row.id)}
            onPrefetch={() => handlers.onPrefetch(row.id)}
            onToggleStar={() => handlers.onToggleStar(row.id, row.is_starred)}
            aiEnabled={handlers.aiEnabled}
            analyzing={handlers.analyzingThreadId === row.id}
            listSummary={handlers.threadAiSummaries[row.id]?.summary}
            onAnalyze={() => handlers.onAnalyze(row.id)}
            onNotSpam={state.mailFolder === "SPAM" ? () => handlers.onNotSpam(row.id) : undefined}
          />
        ))}
      </ul>
      {state.hasNextPage && state.folder !== "STARRED" ? (
        <LoadMore fetching={state.fetchingNextPage} onLoadMore={state.onLoadMore} />
      ) : null}
    </>
  );
}

/** The list pane: full width while no email is open, hidden while one is. */
export function EmailHubViewListPanel({
  header,
  state,
  handlers,
  returnFocusId,
}: {
  header: EmailHubListHeaderProps;
  state: EmailHubListBodyState;
  handlers: EmailHubListRowHandlers;
  /** The email just closed: its row takes focus back, so Esc returns you to your place in the list. */
  returnFocusId: string | null;
}) {
  useEffect(() => {
    if (!returnFocusId) return;
    const row = document.querySelector<HTMLElement>(`[data-thread-row="${CSS.escape(returnFocusId)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
    // Only on mount: the list is re-created each time the reading pane closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <EmailHubListHeader {...header} />
      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ListBody state={state} handlers={handlers} />
      </div>
    </section>
  );
}
