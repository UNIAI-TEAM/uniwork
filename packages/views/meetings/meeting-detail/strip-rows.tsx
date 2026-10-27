"use client";
import { Ban, CalendarX, CloudUpload, Lock, Mic, Play, RotateCcw, TriangleAlert, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useExtendMeeting, useRestoreMeeting, useStartMeeting } from "@uniwork/core/meetings";
import { meetingVenue } from "@uniwork/core/meetings/venue";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../../toast-api-error";
import { MeetingCalendarButton } from "../meeting-calendar-button";
import { MeetingRecordHeldButton } from "../meeting-record-held-dialog";
import { ScheduleFollowUpButton } from "../schedule-follow-up-button";
import { dueWords } from "./close-out/action-item-row";
import { useDetail } from "./detail-context";
import { clock, dayWord, shortDay, untilWords } from "./format";
import { NameSpeakersButton, TranscribingRow, UnsentRow } from "./in-person-rows";
import type { StripJob } from "./next-step-jobs";
import { PhonePrimary, usePhoneBar } from "./phone-frame";
import { kitButton } from "./ui/kit-buttons";
import { useSeriesStrip } from "./scheduled/use-series-strip";
import { StripRow } from "./ui/strip";

/** What the page hands the strip: its commands and the names its sentences need. */
export type StripHandlers = {
  onJoin: () => void;
  onEnd: () => void;
  /** Rà và giao: the overview tab, scrolled to the action items with focus on the first control. */
  onReview: () => void;
  /** Chốt biên bản: the minutes tab with the finalize confirm open. */
  onFinalize: () => void;
  /** Đặt lại lịch: the page's edit sheet, which outlives the missed row once the meeting is scheduled again. */
  onEdit: () => void;
  onFollowUpCreated: (meetingId: string) => void;
  /** Bắt đầu ghi âm of an in-person meeting; without it the page offers no recording. */
  onRecord?: (opts?: { send?: boolean }) => void;
  hostName: string;
  /** Who can assign (host, secretaries), for "chờ Lan Phạm hoặc Hà Vũ giao". */
  clerkNames: string[];
  canceledBy?: { name?: string; at?: string };
};

const lg = (...extra: string[]) => cn(kitButton.base, ...extra);

/** "An, Bình, Chi +2": a big meeting's non-responders never fill the strip. */
function firstNames(names: string[]): string {
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}
const SOON_MS = 15 * 60_000;

/** A strip sentence led by an icon in ink (kit `.notice` without a tone): missed, canceled, the outsider's lock. */
function StripNotice({ icon: Icon, muted, children }: { icon: LucideIcon; muted?: boolean; children: ReactNode }) {
  return (
    <p className={cn("flex min-w-0 flex-1 items-start text-body", muted ? "gap-3" : "gap-2")}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", muted && "text-muted-foreground")} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A strip sentence whose clock is its own `<time>` (kit `… <time>15:45</time> hôm qua …`). */
function Timed({ k, values }: { k: string; values: Record<string, string> }) {
  const { t } = useTranslation();
  return <Trans t={t} i18nKey={k} values={values} components={{ t: <time /> }} />;
}

/** "hôm qua" / "hôm nay" / "ngày mai", else "T5 22/10". */
function dayOf(iso: string, now: number, t: ReturnType<typeof useTranslation>["t"]) {
  return dayWord(iso, now, t) ?? shortDay(iso, now, t);
}

function StartRow({ job, h }: { job: Extract<StripJob, { kind: "start" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const { meeting, now, workspaceId } = useDetail();
  const start = useStartMeeting(workspaceId);
  const startsAt = Date.parse(meeting.starts_at);
  const due = now >= startsAt - SOON_MS;
  const until = untilWords(meeting.starts_at, now, t);
  // A follow-up, not yet due: what it carries on from instead of when it starts (SeriesBrief).
  const series = useSeriesStrip(job.canStart && !due);
  const lead = now < startsAt ? (
    <Timed k="meetings.detail.strip.startsAt" values={{ day: dayOf(meeting.starts_at, now, t), time: clock(meeting.starts_at) }} />
  ) : (
    <Timed k="meetings.detail.strip.startsLate" values={{ time: clock(meeting.starts_at) }} />
  );
  const primary = job.inPerson ? (
    // In person there is no room to start or join: a clerk records it, where the page can.
    job.canRecord && h.onRecord ? (
      <Button type="button" size="lg" variant={due ? "brand" : "outline"} className={lg(due ? "" : kitButton.outline)} onClick={() => h.onRecord?.()}>
        <Mic aria-hidden />
        {t("meetings.venue.startRecording")}
      </Button>
    ) : null
  ) : job.canStart ? (
    <Button
      type="button"
      size="lg"
      variant={due ? "brand" : "outline"}
      className={lg(due ? "" : kitButton.outline)}
      aria-disabled={start.isPending || undefined}
      onClick={() => {
        if (!start.isPending) start.mutate(meeting.id, { onError: (err) => toastApiError(err, t("common.error")) });
      }}
    >
      {/* SeriesBrief draws the follow-up's start without the glyph. */}
      {series ? null : <Play aria-hidden />}
      {t("meetings.detail.strip.startButton")}
    </Button>
  ) : (
    <Button type="button" size="lg" variant={due ? "brand" : "outline"} className={lg(due ? "" : kitButton.outline)} onClick={h.onJoin}>
      <Video aria-hidden />
      {t("meetings.join")}
    </Button>
  );
  return (
    <StripRow
      title={
        series ? (
          <>
            <strong>{series.lead}</strong>
            {t("meetings.detail.strip.tail", { text: series.rest })}
          </>
        ) : (
          <>
            <strong>{lead}</strong>
            {until ? t("meetings.detail.strip.tail", { text: until }) : null}
          </>
        )
      }
      caption={
        series
          ? series.caption || undefined
          : job.pendingNames.length > 0
          ? t("meetings.detail.strip.notAnswered", { count: job.pendingNames.length, names: firstNames(job.pendingNames) })
          : undefined
      }
      actions={
        <>
          <MeetingCalendarButton meetingId={meeting.id} title={meeting.title} className={lg(kitButton.ghost)} />
          {/* Any clerk may record it held (the server's RecordHeld); online keeps the runner's gate. */}
          {(job.canStart || (job.inPerson && job.canRecord)) && now >= startsAt ? (
            <MeetingRecordHeldButton
              workspaceId={workspaceId}
              meeting={meeting}
              size="lg"
              className={lg(kitButton.outline)}
              label={job.inPerson ? t("meetings.venue.haveFile") : undefined}
              icon={job.inPerson ? CloudUpload : undefined}
            />
          ) : null}
          <PhonePrimary>{primary}</PhonePrimary>
        </>
      }
    />
  );
}

function LiveRow({ job, h }: { job: Extract<StripJob, { kind: "live" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const phone = usePhoneBar();
  const actions = (
    <>
      {job.canEnd && !phone ? (
        <Button type="button" size="lg" variant="ghost" className={lg(kitButton.ghostDanger)} onClick={h.onEnd}>
          {t("meetings.end")}
        </Button>
      ) : null}
      <PhonePrimary>
        <Button type="button" size="lg" variant="brand" className={lg()} onClick={h.onJoin}>
          <Video aria-hidden />
          {t("meetings.join")}
        </Button>
      </PhonePrimary>
    </>
  );
  // With jobs below (the lobby, a vote), the row is their heading; alone it says the meeting runs.
  if (job.need > 0) {
    return (
      <StripRow className="min-h-0 pt-3 pb-1 @max-[37.5rem]/meeting:pb-0 [[data-panel=roll]_&]:py-1.5">
        <h2 className="text-caption font-medium text-muted-foreground">{t("meetings.detail.strip.needYou", { count: job.need })}</h2>
        {phone ? null : <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
        {phone ? actions : null}
      </StripRow>
    );
  }
  return <StripRow title={<strong>{t("meetings.detail.strip.liveNow")}</strong>} actions={actions} />;
}

function OvertimeRow({ job, h }: { job: Extract<StripJob, { kind: "overtime" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const { meeting, workspaceId } = useDetail();
  const extend = useExtendMeeting(workspaceId);
  return (
    <StripRow
      actions={
        job.canAct ? (
          <>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className={lg(kitButton.outline)}
              aria-disabled={extend.isPending || undefined}
              onClick={() => {
                if (extend.isPending) return;
                extend.mutate(meeting.id, {
                  onSuccess: () => toast.success(t("meetings.extendedFifteen")),
                  onError: (err) => toastApiError(err, t("common.error")),
                });
              }}
            >
              {t("meetings.extendWindow")}
            </Button>
            <PhonePrimary>
              <Button type="button" size="lg" variant="destructiveSolid" className={lg()} onClick={h.onEnd}>
                {t("meetings.end")}
              </Button>
            </PhonePrimary>
          </>
        ) : undefined
      }
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 text-warning">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="min-w-0 text-body font-medium">
          {t(job.canAct ? "meetings.detail.strip.overtime" : "meetings.detail.strip.overtimeMember", { time: clock(meeting.ends_at) })}
        </p>
      </div>
    </StripRow>
  );
}

function MissedRow({ job, h }: { job: Extract<StripJob, { kind: "missed" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const { meeting, now, workspaceId } = useDetail();
  return (
    <StripRow
      actions={
        job.canAct ? (
          <>
            <MeetingRecordHeldButton
              workspaceId={workspaceId}
              meeting={meeting}
              size="lg"
              className={lg(kitButton.outline, "[&>svg]:hidden")}
              label={meetingVenue(meeting) === "in_person" ? t("meetings.venue.haveFile") : undefined}
            />
            <PhonePrimary>
              <Button type="button" size="lg" variant="brand" className={lg()} onClick={h.onEdit}>
                {t("meetings.detail.strip.reschedule")}
              </Button>
            </PhonePrimary>
          </>
        ) : undefined
      }
    >
      <StripNotice icon={CalendarX}>
        {job.canAct ? (
          <>
            {/* Kit `.notice strong` keeps the browser's bold here; the canceled row is `.strip-text` (600). */}
            <strong>{t("meetings.detail.strip.missedLead")}</strong>
            <Timed k="meetings.detail.strip.missedRest" values={{ time: clock(meeting.ends_at), day: dayOf(meeting.ends_at, now, t) }} />
          </>
        ) : (
          t("meetings.detail.strip.missedMember", { host: h.hostName })
        )}
      </StripNotice>
    </StripRow>
  );
}

function CanceledRow({ job, h }: { job: Extract<StripJob, { kind: "canceled" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const { meeting, now, workspaceId } = useDetail();
  const restore = useRestoreMeeting(workspaceId);
  const by = h.canceledBy;
  return (
    <StripRow
      actions={
        job.canRestore ? (
          <Button
            type="button"
            size="lg"
            variant="outline"
            className={lg(kitButton.outline)}
            aria-disabled={restore.isPending || undefined}
            onClick={() => {
              if (restore.isPending) return;
              restore.mutate(
                { meetingId: meeting.id, version: meeting.version },
                {
                  onSuccess: () => toast.success(t("meetings.meetingRestoredToast")),
                  onError: (err) => toastApiError(err, t("common.error")),
                },
              );
            }}
          >
            <RotateCcw aria-hidden />
            {t("meetings.restore")}
          </Button>
        ) : undefined
      }
    >
      <StripNotice icon={Ban}>
        {by?.name ? <strong className="font-semibold">{t("meetings.detail.strip.canceledBy", { name: by.name })}</strong> : <strong className="font-semibold">{t("meetings.detail.strip.canceled")}</strong>}
        {by?.name && by.at ? (
          <Timed k="meetings.detail.strip.canceledAt" values={{ time: clock(by.at), day: dayOf(by.at, now, t) }} />
        ) : by?.name ? (
          "."
        ) : null}
        {job.canRestore ? null : t("meetings.detail.strip.canceledNothingToDo")}
      </StripNotice>
    </StripRow>
  );
}

function CloseOutRow({ job, h }: { job: Extract<StripJob, { kind: "closeOut" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const { meeting, now, workspaceId, participants } = useDetail();
  const phone = usePhoneBar();
  const minutes =
    job.minutes === "draft"
      ? t("meetings.detail.strip.minutesDraft")
      : job.minutes === "final"
        ? t("meetings.detail.strip.minutesFinal")
        : job.minutes === "none"
          ? t("meetings.detail.strip.minutesNone")
          : null;
  const lead = job.drafting
    ? t("meetings.detail.strip.drafting")
    : job.pending > 0
      ? t("meetings.detail.strip.pendingItems", { count: job.pending })
      : job.converted > 0
        ? t("meetings.detail.strip.allAssigned")
        : minutes;
  // While drafting, the minutes follow in lower case ("Đang soạn tóm tắt · biên bản chưa có").
  const rest = job.drafting
    ? job.minutes === "off"
      ? null
      : t(`meetings.detail.strip.minutesTail_${job.minutes}`)
    : lead === minutes
      ? job.noItems && minutes
        ? t("meetings.detail.strip.noItems")
        : null
      : minutes;
  const caption = [
    job.earliestDue ? t("meetings.detail.strip.earliestDue", { date: dueWords(job.earliestDue, now, t) }) : null,
    job.guessed > 0 ? t(phone ? "meetings.detail.strip.guessedShort" : "meetings.detail.strip.guessed", { count: job.guessed }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const review = job.pending > 0;
  // In person, the speakers come first: the items follow, the minutes wait until they are named (board p09).
  const unnamed = job.unnamedSpeakers ?? 0;
  const head =
    unnamed > 0
      ? {
          lead: t("meetings.record.unnamedSpeakers", { count: unnamed }),
          rest: review ? t("meetings.detail.strip.pendingItems", { count: job.pending }) : null,
        }
      : { lead, rest };
  return (
    <StripRow
      title={
        head.lead ? (
          <>
            <strong>{head.lead}</strong>
            {head.rest ? t("meetings.detail.strip.tail", { text: head.rest }) : null}
          </>
        ) : undefined
      }
      caption={unnamed > 0 ? t("meetings.record.unnamedHint") : caption || undefined}
      actions={
        <>
          {unnamed > 0 && (!phone || !review) ? (
            <PhonePrimary>
              <NameSpeakersButton primary={!review} />
            </PhonePrimary>
          ) : null}
          {job.canFollowUp && !phone && unnamed === 0 ? (
            <ScheduleFollowUpButton workspaceId={workspaceId} meeting={meeting} participants={participants} onCreated={h.onFollowUpCreated} />
          ) : null}
          {job.canFinalize && unnamed === 0 && (!phone || !review) ? (
            <PhonePrimary>
              <Button
                type="button"
                size="lg"
                variant={review ? "outline" : "brand"}
                className={lg(review ? kitButton.outline : "")}
                onClick={h.onFinalize}
              >
                {t("meetings.detail.strip.finalize")}
              </Button>
            </PhonePrimary>
          ) : null}
          {review ? (
            <PhonePrimary>
              <Button type="button" size="lg" variant="brand" className={lg()} onClick={h.onReview}>
                {t("meetings.detail.strip.review", { count: job.pending })}
              </Button>
            </PhonePrimary>
          ) : null}
        </>
      }
    />
  );
}

function MemberItemsRow({ job, h }: { job: Extract<StripJob, { kind: "memberItems" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const { now } = useDetail();
  const parts = [
    job.assigned > 0 ? t("meetings.detail.strip.memberAssigned", { count: job.assigned }) : null,
    job.waiting > 0
      ? t("meetings.detail.strip.memberWaiting", {
          count: job.waiting,
          names: h.clerkNames.join(t("meetings.detail.strip.or")),
        })
      : null,
  ].filter(Boolean);
  return (
    <StripRow
      title={
        <>
          <strong>{t("meetings.detail.strip.memberItems", { count: job.mine })}</strong>
          {parts.length > 0 ? t("meetings.detail.strip.tail", { text: parts.join(" · ") }) : null}
        </>
      }
      caption={
        job.nearest
          ? t("meetings.detail.strip.nearest", { title: job.nearest.title, date: dueWords(job.nearest.due, now, t) })
          : undefined
      }
    />
  );
}

function OutsiderRow() {
  const { t } = useTranslation();
  return (
    <StripRow>
      <StripNotice icon={Lock} muted>
        {t("meetings.detail.strip.outsider")}
      </StripNotice>
    </StripRow>
  );
}

/** One row of the strip for one job. The rsvp and live-jobs rows belong to packages G and F. */
export function StripJobRow({ job, handlers }: { job: StripJob; handlers: StripHandlers }) {
  switch (job.kind) {
    case "start":
      return <StartRow job={job} h={handlers} />;
    case "live":
      return <LiveRow job={job} h={handlers} />;
    case "overtime":
      return <OvertimeRow job={job} h={handlers} />;
    case "missed":
      return <MissedRow job={job} h={handlers} />;
    case "canceled":
      return <CanceledRow job={job} h={handlers} />;
    case "closeOut":
      return <CloseOutRow job={job} h={handlers} />;
    case "memberItems":
      return <MemberItemsRow job={job} h={handlers} />;
    case "transcribing":
      return <TranscribingRow job={job} h={handlers} />;
    case "unsent":
      return <UnsentRow job={job} h={handlers} />;
    case "outsider":
      return <OutsiderRow />;
    default:
      return null;
  }
}
