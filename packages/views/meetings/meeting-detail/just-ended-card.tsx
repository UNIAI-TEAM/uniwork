"use client";

import type { ReactNode } from "react";
import { CalendarPlus, Check, Circle, FileText, SquareCheck, UserRoundCheck, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { useFinalizeAttendance, useMeetingAttendance } from "@uniwork/core/meetings/attendance";
import { useMeetingSummary } from "@uniwork/core/meetings/summary";
import { IconTile, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../../toast-api-error";
import { MeetingSheet } from "../meeting-sheet";
import { useDetail } from "./detail-context";
import type { StripJob } from "./next-step-jobs";
import type { StripHandlers } from "./strip-rows";
import { kitButton } from "./ui/kit-buttons";

type Tone = "done" | "busy" | "warn" | "plain";
const CHIP: Record<Tone, string> = {
  done: "bg-success-soft text-success-soft-foreground",
  busy: "bg-tint-violet text-tint-violet-foreground",
  warn: "bg-destructive-soft text-destructive-soft-foreground",
  plain: "bg-surface-hover text-muted-foreground",
};

function Step({
  icon,
  tone,
  label,
  state,
  stateTone,
  children,
}: {
  icon: LucideIcon;
  tone: "brand" | "info" | "warning" | "destructive" | Tint;
  label: string;
  state: string;
  stateTone: Tone;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3.5 border-b border-border/60 px-5 py-3.5 last:border-b-0">
      <IconTile icon={icon} tone={tone} size="sm" shape="circle" />
      <span className="min-w-0 flex-[1_1_12rem] text-body-lg font-medium text-foreground">{label}</span>
      <span className={cn("rounded-full px-2.5 py-0.5 text-caption font-medium", CHIP[stateTone])}>{state}</span>
      {children}
    </li>
  );
}

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Board E: what the host lands on after ending the meeting for everyone, in
 * place of the next-step strip — the close-out as five steps (attendance,
 * minutes, assigning, the next meeting, the recording) with how many are left.
 */
export function MeetingJustEndedCard({
  job,
  handlers,
}: {
  job: Extract<StripJob, { kind: "closeOut" }>;
  handlers: StripHandlers;
}) {
  const { t } = useTranslation();
  const { meeting, workspaceId, participants, isClerk } = useDetail();
  const { data: attendance } = useMeetingAttendance(meeting.id);
  const finalize = useFinalizeAttendance(meeting.id);
  const { data: recordings } = useRecordings(meeting.id);
  const { data: summary } = useMeetingSummary(meeting.id);

  const roll = attendance?.summary;
  const present = roll ? roll.present + roll.late : 0;
  const finalized = Boolean(attendance?.finalized_at);
  const followedUp = Boolean(meeting.next_meeting_id);
  const recording = (recordings ?? []).find((r) => r.status === "PROCESSING" || r.status === "COMPLETE");
  const recSeconds =
    recording?.started_at && recording.ended_at
      ? Math.round((Date.parse(recording.ended_at) - Date.parse(recording.started_at)) / 1000)
      : null;
  const tasks = job.pending + job.converted;
  const decisions = summary?.decisions?.length ?? 0;
  const remaining =
    Number(!finalized) +
    Number(job.minutes !== "final" && job.minutes !== "off") +
    Number(job.pending > 0 || job.drafting) +
    Number(!followedUp && job.canFollowUp);

  const minutesState: { text: string; tone: Tone } = job.drafting
    ? { text: t("meetings.closeOut.minutesDrafting"), tone: "busy" }
    : job.minutes === "final"
      ? { text: t("meetings.closeOut.minutesFinal"), tone: "done" }
      : job.minutes === "draft"
        ? { text: t("meetings.closeOut.minutesDraft"), tone: "plain" }
        : job.minutes === "none"
          ? { text: t("meetings.closeOut.minutesNone"), tone: "plain" }
          : { text: t("meetings.closeOut.minutesOff"), tone: "plain" };
  const assignState: { text: string; tone: Tone } = job.drafting
    ? { text: t("meetings.closeOut.assignAfter"), tone: "plain" }
    : job.pending > 0
      ? { text: t("meetings.closeOut.assignWaiting"), tone: "plain" }
      : job.converted > 0
        ? { text: t("meetings.closeOut.assignDone"), tone: "done" }
        : { text: t("meetings.closeOut.assignEmpty"), tone: "plain" };

  const chips = [
    roll ? t("meetings.closeOut.present", { count: present }) : null,
    decisions > 0 ? t("meetings.closeOut.decisions", { count: decisions }) : null,
    tasks > 0 ? t("meetings.closeOut.tasks", { count: tasks }) : null,
  ].filter((c): c is string => c !== null);

  return (
    <section
      aria-labelledby="just-ended-heading"
      className="mt-5 overflow-hidden rounded-[18px] border border-success/30 bg-success-soft/50"
    >
      <div className="flex flex-wrap items-center gap-3.5 px-5 py-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success text-on-solid">
          <Check aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-[1_1_16rem]">
          <h2 id="just-ended-heading" className="font-display text-title font-bold text-foreground">
            {t("meetings.closeOut.title")}
          </h2>
          <p className="mt-0.5 text-body text-muted-foreground">
            {remaining > 0 ? t("meetings.closeOut.remaining", { count: remaining }) : t("meetings.closeOut.done")}
          </p>
        </div>
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-border bg-background px-2.5 py-1 text-caption text-foreground">
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <ol className="border-t border-success/20 bg-background">
        <Step
          icon={UserRoundCheck}
          tone="brand"
          label={t("meetings.closeOut.attendance")}
          state={
            finalized
              ? t("meetings.closeOut.finalized")
              : t("meetings.closeOut.attendanceState", { present, members: roll?.members ?? 0 })
          }
          stateTone={finalized ? "done" : "plain"}
        >
          {!finalized && isClerk ? (
            <Button
              type="button"
              variant="brand"
              size="lg"
              className={cn(kitButton.base, "min-w-24")}
              aria-disabled={finalize.isPending || undefined}
              onClick={() => {
                if (!finalize.isPending) finalize.mutate(undefined, { onError: (err) => toastApiError(err, t("common.error")) });
              }}
            >
              {t("meetings.closeOut.finalize")}
            </Button>
          ) : null}
        </Step>
        <Step icon={FileText} tone="violet" label={t("meetings.closeOut.minutes")} state={minutesState.text} stateTone={minutesState.tone}>
          {job.drafting ? (
            <span aria-hidden className="animate-caption-thumb-sweep h-1 w-24 rounded-full" />
          ) : job.minutes === "draft" && job.canFinalize ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className={cn(kitButton.base, kitButton.outline, "min-w-24")}
              aria-label={t("meetings.closeOut.minutesFinalize")}
              onClick={handlers.onFinalize}
            >
              {t("meetings.closeOut.finalize")}
            </Button>
          ) : null}
        </Step>
        <Step
          icon={SquareCheck}
          tone="info"
          label={job.pending > 0 ? t("meetings.closeOut.assign", { count: job.pending }) : t("meetings.closeOut.assignNone")}
          state={assignState.text}
          stateTone={assignState.tone}
        >
          {job.pending > 0 && !job.drafting ? (
            <Button type="button" variant="brand" size="lg" className={cn(kitButton.base, "min-w-24")} onClick={handlers.onReview}>
              {t("meetings.closeOut.assignAction")}
            </Button>
          ) : null}
        </Step>
        <Step
          icon={CalendarPlus}
          tone="warning"
          label={t("meetings.closeOut.followUp")}
          state={followedUp ? t("meetings.closeOut.followUpDone") : t("meetings.closeOut.followUpNone")}
          stateTone={followedUp ? "done" : "plain"}
        >
          {!followedUp && job.canFollowUp ? (
            <MeetingSheet
              mode="followUp"
              workspaceId={workspaceId}
              previous={meeting}
              previousParticipants={participants}
              onDone={handlers.onFollowUpCreated}
              trigger={
                <Button type="button" variant="outline" size="lg" className={cn(kitButton.base, kitButton.outline, "min-w-24")}>
                  {t("meetings.closeOut.followUpAction")}
                </Button>
              }
            />
          ) : null}
        </Step>
        {recording && recSeconds !== null ? (
          <Step
            icon={Circle}
            tone="destructive"
            label={t("meetings.closeOut.recording", { time: mmss(recSeconds) })}
            state={t(recording.status === "PROCESSING" ? "meetings.closeOut.recordingProcessing" : "meetings.closeOut.recordingReady")}
            stateTone={recording.status === "PROCESSING" ? "warn" : "done"}
          />
        ) : null}
      </ol>
    </section>
  );
}
