"use client";

import { useMemo, type ReactNode } from "react";
import { Bell, CalendarCheck, Circle, Clock, Users, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useMeetingActivity, useRecordings } from "@uniwork/core/meetings";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { useMeetingAttendance, useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { useMeetingSummary, useMeetingSummaryRun } from "@uniwork/core/meetings/summary";
import { useNotificationPreferences } from "@uniwork/core/notifications";
import type { Meeting } from "@uniwork/core/types";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { cn } from "@uniwork/ui/lib/utils";
import { useNavigation } from "../../navigation";
import { FeedKindMark } from "../meeting-copilot/feed-filter-chips";
import { meetingLocale } from "../meeting-datetime";
import { MeetingPersonAvatar } from "../meeting-person";
import { useMemberIndex } from "../use-member-index";
import { ExitActions, ExitBottom, ExitStory } from "./exit-left";
import { endedFacts } from "./exit-ended-model";
import { ExitHeading, ExitMark } from "./exit-shell";

const RECAP_KIND = { clerk: "meeting_summary_ready", member: "meeting_recap_ready" } as const;

/** The recap or summary-ready notification is on unless every channel of it was turned off. */
function useNotifiedOfMinutes(isClerk: boolean): boolean {
  const { data } = useNotificationPreferences();
  const row = data?.find((p) => p.kind === RECAP_KIND[isClerk ? "clerk" : "member"]);
  return !row || row.in_app || row.push || row.email;
}

function StatTile({ icon: Icon, value, label, tone }: { icon: LucideIcon; value: string; label: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[14px] border border-border bg-surface px-2 py-3.5">
      <Icon aria-hidden className={cn("size-4 text-muted-foreground", tone)} />
      <span className="font-display text-title-lg font-bold text-foreground tabular-nums">{value}</span>
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

const clock = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Board D: the meeting ended around the viewer (or while they were out). */
export function ExitEnded({
  meeting,
  workspaceId,
  meetingsHref,
  rating,
  onBackToMeeting,
}: {
  meeting: Meeting;
  workspaceId: string;
  meetingsHref?: string;
  rating: ReactNode;
  onBackToMeeting: () => void;
}) {
  const { t, i18n } = useTranslation();
  const phone = useIsMobile();
  const nav = useNavigation();
  const locale = meetingLocale(i18n.language);
  const viewerId = useAuthStore((s) => s.user?.id ?? "");
  const { isClerk } = useMeetingClerk(meeting, workspaceId);
  const { data: activity } = useMeetingActivity(meeting.id);
  const { data: attendance } = useMeetingAttendance(meeting.id);
  const { data: recordings } = useRecordings(meeting.id);
  const { data: items } = useMeetingActionItems(meeting.id);
  const { data: summary } = useMeetingSummary(meeting.id);
  const { data: run } = useMeetingSummaryRun(meeting.id);
  const notified = useNotifiedOfMinutes(isClerk);
  const { memberOf } = useMemberIndex(workspaceId);
  const facts = useMemo(
    () =>
      endedFacts({
        meeting,
        activity: activity ?? [],
        attendance,
        recordings: recordings ?? [],
        actionItems: items?.items ?? [],
        summary,
        viewerId,
      }),
    [meeting, activity, attendance, recordings, items, summary, viewerId],
  );
  const enderName = facts.endedBy?.kind === "person" ? (memberOf(facts.endedBy.userId)?.display_name ?? "") : "";
  const time = clock(facts.endedAt, locale);
  const composing = run?.status === "queued" || run?.status === "running";

  const ender =
    facts.endedBy?.kind === "auto" ? (
      <span>{t("meetings.exit.ended.auto", { time })}</span>
    ) : enderName ? (
      <span className="inline-flex items-center gap-2">
        <MeetingPersonAvatar name={enderName} size={22} />
        {phone
          ? t("meetings.exit.ended.phoneLine", {
              name: enderName,
              time,
              duration: t("meetings.exit.ended.minutes", { count: facts.durationMinutes ?? 0 }),
            })
          : `${t("meetings.exit.ended.by", { name: enderName, time })} · ${meeting.title}`}
      </span>
    ) : (
      <span>{meeting.title}</span>
    );

  const stats = phone ? null : (
    <div className={cn("grid w-full gap-2.5", facts.recording ? "grid-cols-3" : "grid-cols-2")}>
      <StatTile
        icon={Clock}
        value={t("meetings.exit.ended.minutes", { count: facts.durationMinutes ?? 0 })}
        label={t("meetings.exit.ended.minutesLabel")}
      />
      <StatTile
        icon={Users}
        value={facts.present === null ? "—" : t("meetings.exit.ended.people", { count: facts.present })}
        label={t("meetings.exit.ended.peopleLabel")}
      />
      {facts.recording ? (
        <StatTile
          icon={Circle}
          tone="text-destructive"
          value={mmss(facts.recording.seconds)}
          label={t(facts.recording.processing ? "meetings.exit.ended.recordingProcessing" : "meetings.exit.ended.recordingReady")}
        />
      ) : null}
    </div>
  );

  const kinds = [
    { kind: "decision" as const, count: facts.counts.decision, key: "meetings.exit.ended.decisions" },
    { kind: "task" as const, count: facts.counts.task, key: "meetings.exit.ended.tasks" },
    { kind: "question" as const, count: facts.counts.question, key: "meetings.exit.ended.questions" },
  ].filter((k) => k.count > 0);

  const scribe =
    composing || summary ? (
      <section className="flex w-full flex-col gap-3 rounded-2xl border border-tint-violet-foreground/30 bg-tint-violet/40 p-4 text-left">
        <div className="flex items-center gap-3">
          <ScribeMark size={32} state={composing ? "composing" : "idle"} />
          <div className="min-w-0 flex-1">
            <h2 className="text-body-lg font-semibold text-foreground">
              {t(composing ? "meetings.exit.ended.scribeComposing" : "meetings.exit.ended.scribeReady")}
            </h2>
            {composing ? <div aria-hidden className="animate-caption-thumb-sweep mt-2 h-1 rounded-full" /> : null}
          </div>
          {composing && notified ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-tint-violet px-3 py-2 text-label font-medium text-tint-violet-foreground">
              <Bell aria-hidden className="size-3.5" />
              {phone ? <span className="sr-only">{t("meetings.exit.ended.notify")}</span> : t("meetings.exit.ended.notify")}
            </span>
          ) : null}
        </div>
        {kinds.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <span key={k.kind} className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pr-2.5 pl-1 text-caption text-foreground">
                <FeedKindMark kind={k.kind} size="chip" />
                {t(k.key, { count: k.count })}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    ) : null;

  const mine =
    facts.mine.length > 0 ? (
      <section className="w-full rounded-2xl border border-border bg-surface text-left">
        <h2 className="px-4 pt-3 pb-1 text-label font-semibold text-muted-foreground">{t("meetings.exit.ended.mine")}</h2>
        <ul>
          {facts.mine.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
              <span aria-hidden className="size-4 shrink-0 rounded-[5px] border-[1.5px] border-primary" />
              <span className="min-w-0 flex-1 truncate text-body text-foreground">{m.title}</span>
              {m.due ? (
                <span className="shrink-0 rounded-md bg-surface-hover px-2 py-0.5 text-caption text-muted-foreground tabular-nums">
                  {new Date(`${m.due}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const actions = (
    <ExitActions
      primary={
        <Button
          type="button"
          size="lg"
          className="min-h-12 rounded-xl bg-foreground text-body-lg font-semibold text-background hover:bg-foreground/90"
          onClick={onBackToMeeting}
        >
          {t("meetings.exit.ended.viewMeeting")}
        </Button>
      }
      secondary={
        meetingsHref ? (
          <ButtonLink
            href={meetingsHref}
            variant="outline"
            size="lg"
            className="min-h-12 rounded-xl text-body-lg"
            onClick={(e) => {
              e.preventDefault();
              nav.push(meetingsHref);
            }}
          >
            {t("meetings.exit.ended.toMeetings")}
          </ButtonLink>
        ) : null
      }
    />
  );

  const story = (
    <>
      <ExitMark className={cn("bg-success-soft text-success-soft-foreground ring-success/10", phone && "size-14")}>
        <CalendarCheck aria-hidden />
      </ExitMark>
      <ExitHeading title={t("meetings.exit.ended.title")}>
        <div className="text-body text-muted-foreground">{ender}</div>
      </ExitHeading>
      {stats}
      {scribe}
      {mine}
    </>
  );

  if (phone) {
    return (
      <>
        <ExitStory>{story}</ExitStory>
        <ExitBottom>{actions}</ExitBottom>
      </>
    );
  }
  return (
    <>
      {story}
      {actions}
      {rating}
    </>
  );
}
