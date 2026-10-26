"use client";

import { useTranslation } from "react-i18next";
import { countFeed, type MeetingFeedEntry } from "@uniwork/core/meetings/feed";
import { MeetingCarriedOverSection } from "../meeting-action-items/carried-over-section";
import { MeetingActionItemsSection } from "../meeting-action-items/meeting-action-items-section";
import type { ActionItemSelection } from "../meeting-action-items/use-action-item-conversion";
import type { ScribeChipState } from "../meeting-scribe-chip";
import { MeetingSectionError, MeetingTextSkeleton } from "../meeting-section-state";
import type { SummaryGeneration } from "../meeting-summary/use-summary-generation";
import { FeedFilterChips, type MeetingFeedFilter } from "./feed-filter-chips";
import { MeetingFeedList } from "./feed-list";
import { MeetingSummaryCard } from "./summary-card";
import { UniEmptyState } from "./uni-empty-state";

/**
 * The UNI tab's Highlights view: the summary card, then the kind chips over
 * the feed. A clerk who picks the task chip gets the room's action list
 * instead, ticks and all. Before the meeting has produced anything, the empty
 * state takes the place of chips and feed.
 */
export function UniFeedView({
  gen,
  sourcesLabel,
  entries,
  loading,
  failed,
  onRetry,
  filter,
  onFilterChange,
  unseen,
  canClerk,
  workspaceId,
  meetingId,
  projectId,
  scribeState,
  onJumpToSegment,
  onEditItem,
  editItemId,
  onEditHandled,
  selection,
  onSelectionChange,
  carriedOpen,
  onOpenCarried,
}: {
  gen: SummaryGeneration;
  sourcesLabel: string | null;
  entries: readonly MeetingFeedEntry[];
  /** The feed's sources are still on their way; nothing to show yet. */
  loading: boolean;
  /** A source failed and nothing could be shown in its place. */
  failed: boolean;
  onRetry: () => void;
  filter: MeetingFeedFilter;
  onFilterChange: (filter: MeetingFeedFilter) => void;
  unseen: ReadonlySet<string>;
  canClerk: boolean;
  workspaceId?: string;
  meetingId: string;
  projectId?: string;
  scribeState: ScribeChipState;
  onJumpToSegment: (segmentId: string) => void;
  onEditItem: (itemId: string) => void;
  editItemId?: string;
  onEditHandled: () => void;
  selection: ActionItemSelection;
  onSelectionChange: (count: number) => void;
  carriedOpen: boolean;
  onOpenCarried: () => void;
}) {
  const { t } = useTranslation();
  const empty = !gen.summary && !gen.generating && entries.length === 0;
  const counts = countFeed(entries);
  const shown = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  const clerkTasks = filter === "task" && canClerk && workspaceId;

  if (empty && loading) return <MeetingTextSkeleton className="mx-3 rounded-xl border border-border p-4" />;
  if (empty && failed) {
    return (
      <div className="px-3">
        <MeetingSectionError message={t("meetings.summaryLoadFailed")} onRetry={onRetry} />
      </div>
    );
  }
  // A picked kind keeps the chips (and its pressed chip) even once nothing of that kind is left.
  if (empty && filter === "all") {
    return (
      <>
        <div className="px-3 empty:hidden">
          <MeetingSummaryCard gen={gen} sourcesLabel={sourcesLabel} />
        </div>
        {workspaceId ? (
          <UniEmptyState meetingId={meetingId} workspaceId={workspaceId} scribeState={scribeState} onOpenCarried={onOpenCarried} />
        ) : null}
      </>
    );
  }

  return (
    <div className="px-3">
      <MeetingSummaryCard gen={gen} sourcesLabel={sourcesLabel} />
      <div className="mt-3.5 mb-1.5">
        <FeedFilterChips counts={counts} value={filter} onChange={onFilterChange} />
      </div>
      {clerkTasks ? (
        <div className="space-y-3 pb-3">
          <MeetingActionItemsSection
            workspaceId={workspaceId}
            meetingId={meetingId}
            projectId={projectId}
            canClerk
            variant="room"
            selection={selection}
            editItemId={editItemId}
            onEditHandled={onEditHandled}
            onSelectionChange={onSelectionChange}
          />
          {/* A series carries items over as a project does; the server answers none for a meeting with neither. */}
          <MeetingCarriedOverSection workspaceId={workspaceId} meetingId={meetingId} variant="room" defaultOpen={carriedOpen} />
        </div>
      ) : (
        <MeetingFeedList
          entries={shown}
          unseen={unseen}
          canClerk={canClerk}
          workspaceId={workspaceId ?? ""}
          meetingId={meetingId}
          onJumpToSegment={onJumpToSegment}
          onEditItem={onEditItem}
        />
      )}
    </div>
  );
}
