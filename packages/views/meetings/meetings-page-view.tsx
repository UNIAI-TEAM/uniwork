"use client";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { CalendarDays, Plus, SearchX, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingStatistics, useMeetings } from "@uniwork/core/meetings";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { PAGE_GUTTER } from "../layout/page-header";
import { useNavigation } from "../navigation";
import { InstantMeetingDialog } from "./instant-meeting-dialog";
import { MEETING_FILTERS, MeetingFilters } from "./meeting-filters";
import { MeetingList, MeetingListSkeleton } from "./meeting-list";
import { browserTimeZone } from "./meeting-schedule-fields";
import { NewMeetingDialog } from "./new-meeting-dialog";

const PAGE_SIZE = 20;

/** The reading column the inbox uses: rows stay scannable instead of stretching edge to edge. */
const COLUMN = "mx-auto flex w-full max-w-5xl flex-col gap-3";

/**
 * Filter, search and page live in the URL (`?status=&q=&page=`), so Back from
 * a meeting lands on the same slice of the list, and a link to it can be shared.
 */
function useListParams() {
  const { searchParams, pathname, replace } = useNavigation();
  const rawStatus = searchParams.get("status") ?? "";
  const status = (MEETING_FILTERS as readonly string[]).includes(rawStatus) ? rawStatus : "";
  const q = searchParams.get("q") ?? "";
  const pageParam = Number.parseInt(searchParams.get("page") ?? "", 10);
  const page = Number.isFinite(pageParam) && pageParam > 1 ? pageParam : 1;

  const write = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return { status, q, page, write };
}

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
  const params = useListParams();
  const { status, page, write } = params;
  // The field answers every keystroke; the URL and the request follow when React is idle.
  const [query, setQuery] = useState(params.q);
  const deferredQuery = useDeferredValue(query.trim());
  const offset = (page - 1) * PAGE_SIZE;
  // The last search this view put in the URL. Comparing against it, not the
  // URL, keeps a replace still in flight from being written a second time.
  const writtenQuery = useRef(params.q);

  useEffect(() => {
    if (deferredQuery === writtenQuery.current) return;
    writtenQuery.current = deferredQuery;
    write({ q: deferredQuery || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new search writes; Back remounts the view with the URL's own
  }, [deferredQuery]);

  // The server pages in the order MeetingList draws its day groups (today and
  // ahead first, then the past), cut in the viewer's zone; paging by creation
  // time instead would scatter one day's meetings across pages.
  const [timeZone] = useState(browserTimeZone);
  const { data, isError, isPlaceholderData, refetch } = useMeetings(workspaceId, {
    status: status || undefined,
    q: deferredQuery || undefined,
    limit: PAGE_SIZE,
    offset,
    sort: "starts_at",
    tz: timeZone,
  });
  const { data: stats } = useMeetingStatistics(workspaceId);
  const meetings = data?.meetings ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(query || status);
  const isEmpty = !isError && data !== undefined && total === 0 && !filtered;
  const settled = data !== undefined && !isPlaceholderData;

  // A shared link or a list that shrank can leave ?page past the end, which
  // would render "no results" over a workspace with meetings: go to the last page.
  useEffect(() => {
    if (!settled || total === 0 || page <= pages) return;
    write({ page: pages > 1 ? String(pages) : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `write` is rebuilt every render; the page and its bound decide
  }, [settled, total, page, pages]);

  const resetFilters = () => {
    setQuery("");
    writtenQuery.current = "";
    write({ status: null, q: null, page: null });
  };
  const goToPage = (next: number) => write({ page: next > 1 ? String(next) : null });

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
      {isEmpty ? (
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
        <div className={cn("min-h-0 w-full min-w-0 flex-1 overflow-auto pt-3 pb-6", PAGE_GUTTER)}>
          <div className={COLUMN}>
            {/* Stays above an error too, so a failed search can be changed without retyping it. */}
            <MeetingFilters
              status={status}
              query={query}
              stats={stats}
              onStatus={(next) => write({ status: next || null, page: null })}
              onQuery={setQuery}
            />
            {isError ? (
              <CollectionPageState
                icon={CalendarDays}
                tone="destructive"
                role="alert"
                className="py-10"
                title={t("meetings.listLoadFailed")}
                description={t("meetings.listLoadFailedHint")}
                actions={
                  <Button size="sm" variant="outline" onClick={() => void refetch()}>
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : data === undefined ? (
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
                className={cn("transition-opacity duration-fast", isPlaceholderData && "opacity-60")}
              />
            )}
            {!isError && total > PAGE_SIZE ? (
              <nav aria-label={t("meetings.pagination")} className="flex flex-wrap items-center justify-between gap-2">
                <p aria-live="polite" className="text-caption tabular-nums text-muted-foreground">
                  {t("meetings.pageOf", { page: Math.min(page, pages), pages })}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => goToPage(Math.min(page, pages) - 1)}>
                    {t("meetings.prevPage")}
                  </Button>
                  <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => goToPage(page + 1)}>
                    {t("meetings.nextPage")}
                  </Button>
                </div>
              </nav>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
