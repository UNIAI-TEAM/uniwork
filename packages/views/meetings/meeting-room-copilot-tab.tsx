"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { buildMeetingFeed, transcriptLinks, type SegmentLink } from "@uniwork/core/meetings/feed";
import { Button } from "@uniwork/ui/components/ui/button";
import { AskAnswerCard } from "./meeting-copilot/ask-answer-card";
import { useMeetingSuggestions } from "./meeting-copilot/composer-suggestions";
import type { MeetingFeedFilter } from "./meeting-copilot/feed-filter-chips";
import { MeetingCatchUpCard } from "./meeting-copilot/meeting-catch-up-card";
import { MeetingComposer, type MeetingAsk } from "./meeting-copilot/meeting-composer";
import { UniFeedView } from "./meeting-copilot/uni-feed-view";
import { UniStatusRow, type UniView } from "./meeting-copilot/uni-status-row";
import type { ScribeChipState } from "./meeting-scribe-chip";
import { SummaryLiveRegion, SummaryRegenerateConfirm } from "./meeting-summary/summary-generate-controls";
import { summarySourceFacts, summarySourceList } from "./meeting-summary/summary-sources";
import { useSummaryGeneration } from "./meeting-summary/use-summary-generation";
import { meetingLocale } from "./meeting-datetime";
import { MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";
import { MeetingRoomTranscript } from "./meeting-room-transcript";

const NONE: ReadonlySet<string> = new Set();

/**
 * The room panel's UNI tab: the scribe's status and the view switch on top,
 * one scroll area (Highlights: catch-up, summary, chips and feed, the last
 * Ask UNI exchange; or the transcript), and the composer pinned at the bottom.
 */
export function MeetingRoomCopilotTab({
  workspaceId,
  meetingId,
  projectId,
  canClerk,
  lateMinutes,
  onDismissCatchUp,
  scribeOn = false,
  scribeState,
  unseenItems = NONE,
  onViewChange,
}: {
  workspaceId?: string;
  meetingId: string;
  /** The meeting's project: tasks assigned from the action items start there, as on the detail page. */
  projectId?: string;
  /** Host, secretary or workspace admin. */
  canClerk: boolean;
  /** How late this member joined, when late enough for the catch-up card (B7); guests never get one. */
  lateMinutes?: number | null;
  /** The viewer closed the catch-up card: it stays closed for the meeting, across tab switches. */
  onDismissCatchUp?: () => void;
  /** The AI scribe is in the room, so the transcript fills without anyone turning captions on. */
  scribeOn?: boolean;
  /** What the scribe is doing (`scribeChipState`); undefined where the workspace has no scribe. */
  scribeState?: ScribeChipState;
  /** Action items the scribe wrote that this viewer has not had on screen (useUnseenLiveItems). */
  unseenItems?: ReadonlySet<string>;
  /** Which view and filter are on screen, so the room knows when the live items have been seen. */
  onViewChange?: (view: UniView, filter: MeetingFeedFilter) => void;
}) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<UniView>("feed");
  const [filter, setFilter] = useState<MeetingFeedFilter>("all");
  // Unmounted (another tab), the panel opens on the highlights again: say so, or the room keeps the old view.
  useEffect(() => {
    onViewChange?.(view, filter);
    return () => onViewChange?.("feed", "all");
  }, [onViewChange, view, filter]);
  // A line the feed's time asked for; the transcript mounts with it, so the same line can be asked again.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editItemId, setEditItemId] = useState<string>();
  const [carriedOpen, setCarriedOpen] = useState(false);
  // The clerk's ticks outlive the task list, so a look at the transcript does not cost them.
  const selection = useState<ReadonlySet<string>>(() => new Set());
  const [picked, setPicked] = useState(0);
  const [ask, setAsk] = useState<MeetingAsk | null>(null);
  const onEditHandled = useCallback(() => setEditItemId(undefined), []);

  const gen = useSummaryGeneration({ workspaceId, meetingId, canClerk });
  const { summary, summaryQuery, transcriptQuery, chatQuery, notesQuery } = gen;
  // Action items are for members only.
  const itemsQuery = useMeetingActionItems(workspaceId ? meetingId : "");
  const recordingsQuery = useRecordings(meetingId);
  const recordings = recordingsQuery.data;
  const transcript = transcriptQuery.data;
  const actionItems = itemsQuery.data?.items;
  const entries = useMemo(
    () =>
      buildMeetingFeed({
        actionItems: actionItems ?? [],
        summary,
        notes: notesQuery.data ?? [],
        transcript: transcript ?? [],
        recordings: recordings ?? [],
      }),
    [actionItems, summary, notesQuery.data, transcript, recordings],
  );
  const links = useMemo(() => transcriptLinks({ actionItems: actionItems ?? [], summary }), [actionItems, summary]);
  const suggestions = useMeetingSuggestions(entries.length > 0);
  // The empty state reads every source, so it waits for all of them.
  const sources = [summaryQuery, transcriptQuery, chatQuery, notesQuery, recordingsQuery, ...(workspaceId ? [itemsQuery] : [])];
  const failedOf = (q: { isError: boolean; data?: unknown }) => q.isError && !q.data;
  // Said even when the feed has other things: a missing summary, notes or recordings would otherwise pass for none.
  const loadError = failedOf(notesQuery)
    ? t("meetings.notesLoadFailed")
    : sources.some((q) => q !== recordingsQuery && failedOf(q))
      ? t("meetings.summaryLoadFailed")
      : failedOf(recordingsQuery)
        ? t("meetings.recordingsLoadFailed")
        : null;
  const retry = () => {
    for (const q of sources) if (q.isError) void q.refetch();
  };
  const sourcesLabel = summary
    ? summarySourceList(summarySourceFacts(summary.created_at, gen.sourceTimes).sources, t, meetingLocale(i18n.language))
    : null;
  const transcriptEmpty = t(scribeOn ? "meetings.transcriptEmptyScribe" : "meetings.transcriptEmpty");

  const showView = (next: UniView) => {
    setView(next);
    setFocusId(null);
  };
  const showFilter = (next: MeetingFeedFilter) => {
    setFilter(next);
    setCarriedOpen(false);
  };
  const jumpToSegment = (segmentId: string) => {
    setView("transcript");
    setFocusId(segmentId);
  };
  const openLink = (kind: SegmentLink["kind"]) => {
    showView("feed");
    showFilter(kind);
  };
  const editItem = (itemId: string) => {
    showFilter("task");
    setEditItemId(itemId);
  };
  // The answer shows in the highlights: an ask from the transcript takes the reader there.
  const onAsked = (next: MeetingAsk) => {
    setAsk(next);
    if (next.pending && view === "transcript") showView("feed");
  };
  // The card sits after the whole feed: bring it into view when an ask starts and when its answer lands,
  // not when a remount reads the last answer back.
  const askCard = useRef<HTMLDivElement>(null);
  const asking = useRef(false);
  const askPending = ask?.pending ?? false;
  const askAnswer = ask?.answer?.id;
  useEffect(() => {
    if (askPending) asking.current = true;
    else if (!askAnswer || !asking.current) return;
    else asking.current = false;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    askCard.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [askPending, askAnswer]);
  const openCarried = () => {
    setFilter("task");
    setCarriedOpen(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <UniStatusRow
        state={scribeState}
        hasLines={(transcript ?? []).length > 0}
        view={view}
        onViewChange={showView}
        end={
          view === "transcript" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-[9px] text-muted-foreground"
              aria-label={t("meetings.panel.transcript.search")}
              aria-pressed={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search aria-hidden />
            </Button>
          ) : undefined
        }
      />
      <SummaryLiveRegion message={gen.announcement} seq={gen.announcementSeq} />

      {view === "feed" ? (
        // Room under the last row for the clerk's sticky selection bar, so it never hides a focused row.
        <div className="flex min-h-0 flex-1 scroll-pb-18 flex-col overflow-y-auto pt-0.5 pb-3" data-testid="meeting-copilot-scroll">
          {!gen.aiOn && gen.capsLoaded ? (
            <p className="px-3 pb-2 text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
          ) : null}
          {workspaceId && lateMinutes ? (
            <div className="px-3 pb-2">
              <MeetingCatchUpCard meetingId={meetingId} lateMinutes={lateMinutes} onDismiss={onDismissCatchUp} />
            </div>
          ) : null}
          <UniFeedView
            gen={gen}
            sourcesLabel={sourcesLabel}
            entries={entries}
            loading={sources.some((q) => q.isPending)}
            loadError={loadError}
            onRetry={retry}
            filter={filter}
            onFilterChange={showFilter}
            unseen={unseenItems}
            canClerk={canClerk}
            workspaceId={workspaceId}
            meetingId={meetingId}
            projectId={projectId}
            scribeState={scribeState ?? (scribeOn ? "on" : "off")}
            onJumpToSegment={jumpToSegment}
            onEditItem={editItem}
            editItemId={editItemId}
            onEditHandled={onEditHandled}
            selection={selection}
            onSelectionChange={setPicked}
            carriedOpen={carriedOpen}
            onOpenCarried={openCarried}
          />
          {workspaceId && ask ? (
            <div ref={askCard} className="px-3 pt-3 empty:hidden">
              <AskAnswerCard {...ask} canShare meetingId={meetingId} workspaceId={workspaceId} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
          {transcriptQuery.isPending ? (
            <MeetingTextSkeleton />
          ) : transcriptQuery.isError && !transcript ? (
            <MeetingSectionError message={t("meetings.transcriptLoadFailed")} onRetry={() => void transcriptQuery.refetch()} />
          ) : (
            <MeetingRoomTranscript
              meetingId={meetingId}
              segments={transcript ?? []}
              emptyText={transcriptEmpty}
              links={links}
              focusSegmentId={focusId}
              searchOpen={searchOpen}
              onOpenLink={openLink}
            />
          )}
        </div>
      )}

      {/* Pinned under both views; hidden, not unmounted, while the selection bar stands in for it, so a draft
          or a running question survives. */}
      {workspaceId ? (
        <div hidden={picked > 0} className="shrink-0 border-t border-border px-3 pt-2.5 pb-3">
          <MeetingComposer
            workspaceId={workspaceId}
            meetingId={meetingId}
            notesCount={notesQuery.data?.length ?? 0}
            hasTranscript={(transcript ?? []).length > 0}
            suggestions={suggestions}
            onAsked={onAsked}
          />
        </div>
      ) : null}

      <SummaryRegenerateConfirm gen={gen} />
    </div>
  );
}
