"use client";
import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import type { Meeting } from "@uniwork/core/types";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { MeetingAttendancePanel } from "./meeting-attendance-panel";

/** Detail-page home of the roll: shown once the meeting has started. */
export function MeetingAttendanceCard({ meeting, workspaceId }: { meeting: Meeting; workspaceId: string }) {
  const { t } = useTranslation();
  const { isClerk } = useMeetingClerk(meeting, workspaceId);
  if (meeting.status !== "IN_PROGRESS" && meeting.status !== "ENDED") return null;
  return (
    <PanelCard
      id="attendance-heading"
      icon={ClipboardCheck}
      iconTone={moduleTone("meetings")}
      title={t("meetings.governance.attendanceTitle")}
      flush
    >
      <MeetingAttendancePanel meeting={meeting} workspaceId={workspaceId} canEdit={isClerk} density="compact" />
    </PanelCard>
  );
}
