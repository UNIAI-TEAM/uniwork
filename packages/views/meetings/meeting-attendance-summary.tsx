"use client";
import { useTranslation } from "react-i18next";
import type { MeetingAttendance } from "@uniwork/core/types/meeting";
import { ToneBadge } from "./meeting-status-badge";

/** One line of counts for members, and whether the minimum attendance is met. */
export function MeetingAttendanceSummary({ attendance }: { attendance: MeetingAttendance }) {
  const { t } = useTranslation();
  const { summary, quorum_percent: quorum } = attendance;
  return (
    <div className="space-y-2">
      <p className="text-label text-foreground tabular-nums">
        {t("meetings.governance.summary", {
          count: summary.members,
          present: summary.present,
          late: summary.late,
          excused: summary.excused,
          absent: summary.absent,
        })}
      </p>
      {quorum && summary.quorum_met != null ? (
        <ToneBadge tone={summary.quorum_met ? "success" : "warning"}>
          {summary.quorum_met
            ? t("meetings.governance.quorumMet")
            : t("meetings.governance.quorumMissing", { percent: quorum })}
        </ToneBadge>
      ) : null}
    </div>
  );
}
