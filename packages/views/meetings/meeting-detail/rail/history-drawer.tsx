"use client";
import { useTranslation } from "react-i18next";
import { useMeetingActivity } from "@uniwork/core/meetings";
import type { MeetingActivityItem } from "@uniwork/core/types";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { activityLabel, activityMotionDetail, activityStateChange, visibleActivity } from "../../meeting-activity-display";
import { meetingLocale } from "../../meeting-datetime";
import { formatMeetingDayTime } from "../../meeting-detail-format";
import { MeetingPersonAvatar } from "../../meeting-person";
import { formatRelativeTime } from "../../meeting-relative-time";
import { MeetingRowsSkeleton, MeetingSectionError } from "../../meeting-section-state";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { SideSheet } from "../ui/overlay";

/** Server automation (an automatic end and the votes it closes) writes this id rather than an empty one. */
const SYSTEM_ACTOR_ID = "system";
/** Consecutive rows by one person this close together read as one run under one name. */
const RUN_GAP_MS = 10 * 60_000;

const actorKey = (item: MeetingActivityItem) => (!item.actor_id || item.actor_id === SYSTEM_ACTOR_ID ? SYSTEM_ACTOR_ID : item.actor_id);

/** Whether this row continues the run of the one before it (newest first). */
export function continuesRun(prev: MeetingActivityItem | undefined, item: MeetingActivityItem): boolean {
  if (!prev || actorKey(prev) !== actorKey(item)) return false;
  return Math.abs(Date.parse(prev.occurred_at) - Date.parse(item.occurred_at)) <= RUN_GAP_MS;
}

/**
 * "Lịch sử thao tác" (kit `.drawer` 480): the meeting's activity, newest
 * first, consecutive actions of one person grouped under their name. Opened
 * from the rail link and from the header's ⋯; Esc closes it and focus goes
 * back to the opener.
 */
export function HistoryDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <SideSheet open={open} onOpenChange={onOpenChange} width={480} title={t("meetings.activity")}>
      {open ? <HistoryList /> : null}
    </SideSheet>
  );
}

function HistoryList() {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const { meeting, memberIndex } = useDetail();
  const { data: items, isPending, isError, refetch } = useMeetingActivity(meeting.id);
  const all = visibleActivity(items ?? []);

  if (isPending) return <MeetingRowsSkeleton className="py-1.5" rowClassName="py-2" />;
  if (isError) {
    return <MeetingSectionError message={t("meetings.activityLoadFailed")} onRetry={() => void refetch()} />;
  }
  if (all.length === 0) return <p className="py-6 text-center text-body text-muted-foreground">{t("meetings.activityEmpty")}</p>;

  return (
    <ol aria-label={t("meetings.activity")} className="flex flex-col">
      {all.map((item, i) => {
        const run = continuesRun(all[i - 1], item);
        const system = actorKey(item) === SYSTEM_ACTOR_ID;
        const member = system ? undefined : memberIndex.memberOf(item.actor_id);
        const actor = system ? t("meetings.systemActor") : member?.display_name || t("meetings.formerMember");
        const change = activityStateChange(item);
        const detail = activityMotionDetail(item);
        return (
          <li key={item.id} className={cn("grid grid-cols-[24px_minmax(0,1fr)] gap-x-3", run ? "pt-1.5" : "pt-4 first:pt-0")}>
            <span aria-hidden className="inline-flex">
              {run ? null : system ? (
                <ActorAvatar name={actor} initials="" isSystem size="sm" />
              ) : (
                <MeetingPersonAvatar
                  name={actor}
                  avatarUrl={member?.avatar_url}
                  size={24}
                  tint={meetingAvatarTint(member ? item.actor_id : null, memberIndex.members)}
                />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-body text-foreground">
                {run ? <span className="sr-only">{actor} </span> : <span className="font-medium">{actor} </span>}
                {t(activityLabel(item.event_type))}
              </p>
              {detail ? (
                <p className="mt-0.5 break-words text-body text-foreground">
                  {t(detail.key, detail.vars.outcome ? { ...detail.vars, outcome: t(detail.vars.outcome) } : detail.vars)}
                </p>
              ) : null}
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-caption text-muted-foreground tabular-nums">
                <time dateTime={item.occurred_at} title={formatMeetingDayTime(item.occurred_at, locale)}>
                  {formatRelativeTime(item.occurred_at, locale, undefined, t("meetings.justNow"))}
                </time>
                {change ? <span>{`${t(change.fromKey)} → ${t(change.toKey)}`}</span> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
