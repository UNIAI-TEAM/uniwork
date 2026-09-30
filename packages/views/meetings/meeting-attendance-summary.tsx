"use client";
import { useTranslation } from "react-i18next";
import { attendanceQuorum } from "@uniwork/core/meetings/attendance";
import { ATTENDANCE_STATUSES, type MeetingAttendance } from "@uniwork/core/types/meeting";
import { cn } from "@uniwork/ui/lib/utils";
import { ATTENDANCE_DOT, ATTENDANCE_TONE } from "./meeting-attendance-status";
import { MEETING_TONE_BADGE } from "./meeting-status-badge";

const COUNT_OF = { PRESENT: "present", LATE: "late", EXCUSED: "excused", ABSENT: "absent" } as const;

/**
 * Members at a glance: one tile per status in the same colours as the rows,
 * then how far the roll is from its minimum attendance, in people.
 */
export function MeetingAttendanceSummary({ attendance }: { attendance: MeetingAttendance }) {
  const { t } = useTranslation();
  const { summary } = attendance;
  const q = attendanceQuorum(attendance);
  const met = q.missing === 0;
  return (
    <div className="@container space-y-3">
      <dl className="grid grid-cols-2 gap-2 @md:grid-cols-4">
        {ATTENDANCE_STATUSES.map((s) => (
          <div key={s} className={cn("rounded-lg px-3 py-2", MEETING_TONE_BADGE[ATTENDANCE_TONE[s]])}>
            <dt className="flex items-center gap-1.5 text-caption">
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", ATTENDANCE_DOT[s])} />
              {t(`meetings.governance.status_${s}`)}
            </dt>
            <dd className="text-title-sm font-semibold tabular-nums">{summary[COUNT_OF[s]]}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-label text-foreground tabular-nums">
            {t("meetings.governance.quorumProgress", { attended: q.attended, members: q.members, percent: q.percent })}
          </p>
          <p className="text-caption text-muted-foreground tabular-nums">
            {t("meetings.governance.membersTotal", { count: q.members })}
          </p>
        </div>
        <div aria-hidden className="relative h-1.5 rounded-full bg-muted">
          {/* Scaled, not resized: a transform animates without relayout. */}
          <div className="h-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full w-full origin-left transition-transform duration-fast motion-reduce:transition-none",
                q.required === null || met ? "bg-success" : "bg-warning",
              )}
              style={{ transform: `scaleX(${q.percent / 100})` }}
            />
          </div>
          {q.required !== null ? (
            <span
              className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/60"
              style={{ left: `${q.required}%` }}
            />
          ) : null}
        </div>
        {q.required !== null && q.members > 0 ? (
          <p className={cn("text-caption", met ? "text-success-soft-foreground" : "text-warning-soft-foreground")}>
            {met
              ? t("meetings.governance.quorumMet", { required: q.required })
              : t("meetings.governance.quorumMissing", { required: q.required, count: q.missing })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
