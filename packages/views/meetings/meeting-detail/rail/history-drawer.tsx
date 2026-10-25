"use client";
import {
  Ban,
  CalendarCheck,
  CalendarPlus,
  CircleDot,
  Crown,
  DoorOpen,
  Link2,
  ListChecks,
  Pencil,
  Play,
  RotateCcwClock,
  ShieldBan,
  Square,
  UserMinus,
  UserPlus,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingActivity } from "@uniwork/core/meetings";
import { ScribeGlyph } from "@uniwork/ui/brand/scribe-mark";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { moduleTone } from "../../../layout/module-tones";
import {
  activityKind,
  activityLabel,
  activityMotionDetail,
  activityStateChange,
  visibleActivity,
  type ActivityKind,
} from "../../meeting-activity-display";
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

/** The timeline's mark per kind: the glyph says what happened, the tone how it went; the scribe's work carries its own mark. */
const KIND_MARK: Record<ActivityKind, { icon: LucideIcon; tone: IconTileTone }> = {
  created: { icon: CalendarPlus, tone: "muted" },
  started: { icon: Play, tone: "success" },
  ended: { icon: Square, tone: "muted" },
  canceled: { icon: Ban, tone: "destructive" },
  updated: { icon: Pencil, tone: "muted" },
  host: { icon: Crown, tone: "muted" },
  invited: { icon: UserPlus, tone: "muted" },
  removed: { icon: UserMinus, tone: "muted" },
  rsvp: { icon: CalendarCheck, tone: "muted" },
  join: { icon: DoorOpen, tone: "muted" },
  link: { icon: Link2, tone: "muted" },
  ai: { icon: ScribeGlyph, tone: "violet" },
  recording: { icon: CircleDot, tone: "muted" },
  governance: { icon: Vote, tone: "brand" },
  moderation: { icon: ShieldBan, tone: "muted" },
  other: { icon: ListChecks, tone: "muted" },
};

/**
 * "Lịch sử thao tác" (kit `.drawer` 480): the meeting's activity as a
 * timeline, newest first. Each action has its kind's mark on a rail line,
 * then who did it and what, and when (with the state change, if any).
 * Opened from the rail link (from ⋯ on a phone and in the calendar panel);
 * Esc closes it and focus goes back to the opener.
 */
export function HistoryDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      width={480}
      title={
        <span className="flex items-center gap-3">
          <IconTile icon={RotateCcwClock} size="sm" tone={moduleTone("meetings")} />
          {t("meetings.activity")}
        </span>
      }
    >
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
    // The rail line runs through the marks' centres; each mark's ring in the drawer's colour cuts it.
    <ol aria-label={t("meetings.activity")} className="relative space-y-4 before:absolute before:inset-y-3.5 before:left-3.5 before:w-px before:bg-border">
      {all.map((item) => {
        const system = !item.actor_id || item.actor_id === SYSTEM_ACTOR_ID;
        const member = system ? undefined : memberIndex.memberOf(item.actor_id);
        const actor = system ? t("meetings.systemActor") : member?.display_name || t("meetings.formerMember");
        const change = activityStateChange(item);
        const detail = activityMotionDetail(item);
        const kind = activityKind(item.event_type);
        const mark = KIND_MARK[kind];
        return (
          <li key={item.id} data-kind={kind} className="relative flex min-w-0 items-start gap-3">
            <IconTile icon={mark.icon} size="sm" shape="circle" tone={mark.tone} className="relative ring-4 ring-popover" />
            <div className="min-w-0 flex-1 pt-0.5">
              {/* A div, not a p: the avatars draw block elements. */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-body text-foreground">
                <span aria-hidden className="inline-flex">
                  {system ? (
                    <ActorAvatar name={actor} initials="" isSystem size="sm" />
                  ) : (
                    <MeetingPersonAvatar
                      name={actor}
                      avatarUrl={member?.avatar_url}
                      size={20}
                      tint={meetingAvatarTint(member ? item.actor_id : null, memberIndex.members)}
                    />
                  )}
                </span>
                <span className="font-medium">{actor}</span>
                <span>{t(activityLabel(item.event_type))}</span>
              </div>
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
