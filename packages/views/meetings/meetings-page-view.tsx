"use client";
import { useDeferredValue, useState } from "react";
import { CalendarDays, Plus, SearchX, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingStatistics, useMeetings } from "@uniwork/core/meetings";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { PAGE_GUTTER } from "../layout/page-header";
import { InstantMeetingDialog } from "./instant-meeting-dialog";
import { MeetingFilters } from "./meeting-filters";
import { MeetingList, MeetingListSkeleton } from "./meeting-list";
import { NewMeetingDialog } from "./new-meeting-dialog";

const PAGE_SIZE = 20;

export function MeetingsPageView({
  workspaceId,
  onOpen,
  onOpenRoom,
}: {
  workspaceId: string;
  onOpen: (id: string) => void;
  onOpenRoom: (id: string) => void;
}) {
  const { t } = useTranslation();
  useWorkspaceEvents(workspaceId);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  // Typing updates the input at once; the request follows when React is idle.
  const deferredQuery = useDeferredValue(query.trim());
  const { data, isError, isPlaceholderData, refetch } = useMeetings(workspaceId, {
    status: status || undefined,
    q: deferredQuery || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const { data: stats } = useMeetingStatistics(workspaceId);
  const meetings = data?.meetings ?? [];
  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(query || status);
  const isEmpty = data !== undefined && total === 0 && !filtered;

  const resetFilters = () => {
    setStatus("");
    setQuery("");
    setOffset(0);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <CollectionPageHeader
        icon={CalendarDays}
        tone={moduleTone("meetings")}
        title={t("meetings.title")}
        count={stats?.total ?? total}
        actions={
          <>
            <InstantMeetingDialog
              workspaceId={workspaceId}
              onStarted={onOpenRoom}
              trigger={<CollectionPageHeaderAction icon={Zap} label={t("meetings.instant")} />}
            />
            <NewMeetingDialog
              workspaceId={workspaceId}
              onCreated={onOpen}
              trigger={<CollectionPageHeaderAction icon={Plus} label={t("meetings.new")} variant="default" />}
            />
          </>
        }
      />
      {isError ? (
        <CollectionPageState
          icon={CalendarDays}
          tone="destructive"
          role="alert"
          title={t("common.error")}
          actions={<Button size="sm" variant="outline" onClick={() => void refetch()}>{t("common.retry")}</Button>}
        />
      ) : isEmpty ? (
        <CollectionPageState
          icon={CalendarDays}
          tone={moduleTone("meetings")}
          title={t("meetings.empty_title")}
          description={t("meetings.empty_description")}
          actions={
            <NewMeetingDialog workspaceId={workspaceId} onCreated={onOpen} trigger={<Button size="sm">{t("meetings.new")}</Button>} />
          }
        />
      ) : (
        <div className={cn("flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-auto py-4", PAGE_GUTTER)}>
          <MeetingFilters
            status={status}
            query={query}
            stats={stats}
            onStatus={(next) => {
              setStatus(next);
              setOffset(0);
            }}
            onQuery={(next) => {
              setQuery(next);
              setOffset(0);
            }}
          />
          {data === undefined ? (
            <MeetingListSkeleton />
          ) : meetings.length === 0 ? (
            <CollectionPageState
              icon={SearchX}
              role="status"
              className="py-10"
              title={t("meetings.noResults")}
              description={t("meetings.noResultsHint")}
              actions={
                <Button size="sm" variant="outline" onClick={resetFilters}>
                  {t("meetings.clearFilters")}
                </Button>
              }
            />
          ) : (
            <MeetingList
              workspaceId={workspaceId}
              meetings={meetings}
              onOpenRoom={onOpenRoom}
              className={isPlaceholderData ? "opacity-60 transition-opacity duration-150" : "transition-opacity duration-150"}
            />
          )}
          {total > PAGE_SIZE ? (
            <nav aria-label={t("meetings.pagination")} className="flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-caption tabular-nums text-muted-foreground">
                {t("meetings.pageOf", { page, pages })}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-11 sm:h-7" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  {t("meetings.prevPage")}
                </Button>
                <Button size="sm" variant="outline" className="h-11 sm:h-7" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  {t("meetings.nextPage")}
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}
