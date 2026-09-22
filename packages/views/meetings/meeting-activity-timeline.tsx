"use client";

import {
  Ban,
  CalendarPlus,
  ChevronDown,
  CircleDot,
  Crown,
  History,
  Link2,
  ListChecks,
  Pencil,
  Play,
  Square,
  UserMinus,
  UserPlus,
  DoorOpen,
  CalendarCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingActivity } from "@uniwork/core/meetings";
import { useMembers } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { activityKind, activityLabel, activityStateChange, visibleActivity, type ActivityKind } from "./meeting-activity-display";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { initials, personAvatarSrc } from "./meeting-person";
import { formatRelativeTime } from "./meeting-relative-time";
import { MeetingRowsSkeleton, MeetingSectionError } from "./meeting-section-state";

const VISIBLE_ACTIVITY_LIMIT = 5;

/** Rail mark per kind: the glyph says what happened, the signal says how it went. */
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
  ai: { icon: Sparkles, tone: "brand" },
  recording: { icon: CircleDot, tone: "muted" },
  other: { icon: ListChecks, tone: "muted" },
};

export function MeetingActivityTimeline({
  workspaceId,
  meetingId,
  defaultOpen = false,
}: {
  workspaceId: string;
  meetingId: string;
  defaultOpen?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const { data: items, isPending, isError, refetch } = useMeetingActivity(meetingId);
  const { data: members } = useMembers(workspaceId);
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const all = visibleActivity(items ?? []);
  const visible = showAll ? all : all.slice(0, VISIBLE_ACTIVITY_LIMIT);
  const hiddenCount = Math.max(0, all.length - VISIBLE_ACTIVITY_LIMIT);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <PanelCard
        id="activity-heading"
        icon={History}
        iconTone={moduleTone("meetings")}
        title={t("meetings.activity")}
        flush
        action={
          <CollapsibleTrigger
            render={
              <Button type="button" size="sm" variant="ghost" className="text-muted-foreground">
                {open ? t("meetings.hideActivity") : t("meetings.showActivity", { count: all.length })}
                <ChevronDown
                  className={cn("size-3.5 transition-transform duration-standard", open && "rotate-180")}
                  aria-hidden
                />
              </Button>
            }
          />
        }
      >
        <CollapsibleContent>
          {isPending ? (
            <MeetingRowsSkeleton className="py-1.5" rowClassName="py-2" />
          ) : isError ? (
            <MeetingSectionError
              className="m-4"
              message={t("meetings.activityLoadFailed")}
              onRetry={() => void refetch()}
            />
          ) : all.length === 0 ? (
            <p className="px-4 py-6 text-center text-label text-muted-foreground">{t("meetings.activityEmpty")}</p>
          ) : (
            <div className="px-4 py-4">
              <ol className="relative space-y-3.5 before:absolute before:bottom-3.5 before:left-3.5 before:top-3.5 before:w-px before:bg-border">
                {visible.map((item) => {
                  const system = !item.actor_id;
                  const member = system ? undefined : members?.find((m) => m.user_id === item.actor_id);
                  const actor = system ? t("meetings.systemActor") : member?.display_name || t("meetings.formerMember");
                  const change = activityStateChange(item);
                  const mark = KIND_MARK[activityKind(item.event_type)];
                  return (
                    <li key={item.id} className="relative flex min-w-0 items-start gap-3">
                      <IconTile
                        icon={mark.icon}
                        size="sm"
                        shape="circle"
                        tone={mark.tone}
                        className="relative ring-4 ring-surface"
                      />
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-body text-foreground">
                          <span aria-hidden className="inline-flex">
                            <ActorAvatar
                              name={actor}
                              initials={initials(actor)}
                              avatarUrl={personAvatarSrc(member?.avatar_url)}
                              isSystem={system}
                              size="sm"
                            />
                          </span>
                          <span className="font-medium">{actor}</span>
                          <span>{t(activityLabel(item.event_type))}</span>
                        </div>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-caption tabular-nums text-muted-foreground">
                          <time dateTime={item.occurred_at} title={formatMeetingStart(item.occurred_at, locale)}>
                            {formatRelativeTime(item.occurred_at, locale)}
                          </time>
                          {change ? <span>{`${t(change.fromKey)} → ${t(change.toKey)}`}</span> : null}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {hiddenCount > 0 && !showAll ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 ml-9 px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAll(true)}
                >
                  {t("meetings.showAllActivity", { count: all.length })}
                </Button>
              ) : null}
            </div>
          )}
        </CollapsibleContent>
      </PanelCard>
    </Collapsible>
  );
}
