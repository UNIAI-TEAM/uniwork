"use client";
import { useState } from "react";
import { Clock, PencilLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingFeedEntry } from "@uniwork/core/meetings/feed";
import { formatMessageTime } from "../../chat/chat-message-time";
import { formatDueDate } from "../meeting-action-items/action-item-rows";
import { meetingLocale } from "../meeting-datetime";
import { MeetingPersonAvatar } from "../meeting-person";
import { MeetingRecordingDialog } from "../meeting-recording-dialog";
import { TOUCH_TARGET } from "../touch-target";
import { useMemberIndex } from "../use-member-index";
import { FeedKindMark } from "./feed-filter-chips";

type MemberOf = ReturnType<typeof useMemberIndex>["memberOf"];

/**
 * What the meeting produced, as the UNI tab's feed: one row per entry in the
 * order given (newest first from `buildMeetingFeed`). `unseen` holds the
 * action item ids the viewer has not had on screen (`useUnseenLiveItems`).
 */
export function MeetingFeedList({
  entries,
  unseen,
  canClerk,
  workspaceId,
  meetingId,
  onJumpToSegment,
  onEditItem,
}: {
  entries: readonly MeetingFeedEntry[];
  unseen: ReadonlySet<string>;
  canClerk: boolean;
  workspaceId: string;
  meetingId: string;
  onJumpToSegment: (segmentId: string) => void;
  /** Opens the item's "edit & assign" composer; a clerk's "+ Due" calls it. */
  onEditItem: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const { memberOf } = useMemberIndex(workspaceId);
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <>
      <ol aria-label={t("meetings.panel.feed.label")} className="divide-y divide-border">
        {entries.map((entry) => (
          <FeedRow
            key={entry.id}
            entry={entry}
            isNew={entry.actionItem ? unseen.has(entry.actionItem.id) : false}
            canClerk={canClerk}
            memberOf={memberOf}
            onJumpToSegment={onJumpToSegment}
            onEditItem={onEditItem}
            onPlay={setPlaying}
          />
        ))}
      </ol>
      {playing ? (
        <MeetingRecordingDialog
          open
          onOpenChange={(next) => {
            if (!next) setPlaying(null);
          }}
          meetingId={meetingId}
          recordingId={playing}
        />
      ) : null}
    </>
  );
}

function FeedRow({
  entry,
  isNew,
  canClerk,
  memberOf,
  onJumpToSegment,
  onEditItem,
  onPlay,
}: {
  entry: MeetingFeedEntry;
  isNew: boolean;
  canClerk: boolean;
  memberOf: MemberOf;
  onJumpToSegment: (segmentId: string) => void;
  onEditItem: (itemId: string) => void;
  onPlay: (recordingId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const kindLabel = t(`meetings.panel.kind.${entry.kind}`);
  const ms = entry.at ? Date.parse(entry.at) : NaN;
  const time = Number.isFinite(ms) ? formatMessageTime(ms, locale) : null;
  const { note, recording, segmentId } = entry;
  return (
    <li className="flex gap-2.5 px-0.5 py-2.5">
      {note ? (
        <span role="img" aria-label={kindLabel} className="shrink-0">
          <MeetingPersonAvatar name={note.display_name ?? ""} avatarUrl={note.avatar_url} size={26} />
        </span>
      ) : (
        <FeedKindMark kind={entry.kind} size="row" label={kindLabel} />
      )}
      <div className="min-w-0 flex-1">
        {recording ? (
          <button
            type="button"
            className={`${TOUCH_TARGET} text-body font-medium text-foreground hover:underline`}
            onClick={() => onPlay(recording.id)}
          >
            {t("meetings.panel.feed.playRecording")}
          </button>
        ) : (
          <p className={note ? "text-body text-pretty text-foreground" : "text-body font-medium text-pretty text-foreground"}>{entry.text}</p>
        )}
        {entry.actionItem ? (
          <TaskMeta item={entry.actionItem} canClerk={canClerk} memberOf={memberOf} onEditItem={onEditItem} />
        ) : entry.kind === "question" ? (
          <span className="mt-1.5 inline-flex h-5 items-center rounded-md bg-warning-soft px-1.75 text-micro font-medium text-warning-soft-foreground">
            {t("meetings.panel.feed.open")}
          </span>
        ) : note ? (
          <p className="mt-1.5 flex items-center gap-1 text-caption text-muted-foreground">
            <PencilLine aria-hidden className="size-3" />
            {note.display_name}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 text-caption text-faint-foreground tabular-nums">
        {time && segmentId ? (
          <button
            type="button"
            aria-label={t("meetings.panel.feed.jumpToLine", { time })}
            className={`${TOUCH_TARGET} hover:text-foreground hover:underline`}
            onClick={() => onJumpToSegment(segmentId)}
          >
            {time}
          </button>
        ) : (
          time
        )}
        {isNew ? <span role="img" aria-label={t("meetings.panel.feed.new")} className="size-1.75 rounded-full bg-brand" /> : null}
      </div>
    </li>
  );
}

/** Who has the task (face and name, else what was said of the owner) and when it is due. */
function TaskMeta({
  item,
  canClerk,
  memberOf,
  onEditItem,
}: {
  item: NonNullable<MeetingFeedEntry["actionItem"]>;
  canClerk: boolean;
  memberOf: MemberOf;
  onEditItem: (itemId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const task = item.task;
  // A converted item is the task's now: only its assignee and due date, never what was said or suggested.
  const member = memberOf(task ? task.assignee_id : item.suggested_assignee_id);
  const name = member?.display_name || (task ? null : item.owner_text?.trim()) || null;
  const dueDate = task ? task.due_date : item.suggested_due_date;
  const formatted = dueDate ? formatDueDate(dueDate, locale) : null;
  const due = task ? formatted : item.due_text?.trim() || formatted;
  const addDue = !due && canClerk && item.status === "PENDING";
  if (!name && !due && !addDue) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {member ? <MeetingPersonAvatar name={member.display_name ?? ""} avatarUrl={member.avatar_url} size={18} /> : null}
      {name ? <span className="text-caption text-muted-foreground">{name}</span> : null}
      {due ? (
        <span className="inline-flex h-5 items-center gap-1 rounded-md bg-surface-hover px-1.75 text-micro font-medium text-muted-foreground">
          <Clock aria-hidden className="size-3" />
          {due}
        </span>
      ) : addDue ? (
        <button
          type="button"
          className={`${TOUCH_TARGET} inline-flex h-5 items-center rounded-md border border-dashed border-border px-1.75 text-micro font-medium text-muted-foreground hover:text-foreground`}
          onClick={() => onEditItem(item.id)}
        >
          {t("meetings.panel.feed.addDue")}
        </button>
      ) : null}
    </div>
  );
}
