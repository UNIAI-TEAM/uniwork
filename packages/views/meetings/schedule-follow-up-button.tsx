"use client";
import { CalendarPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { followUpAttendeeIds, followUpScheduleDraft } from "./follow-up-meeting";
import { NewMeetingDialog } from "./new-meeting-dialog";

/**
 * "Lên lịch cuộc họp tiếp theo" (follow-4): the schedule form, filled in from
 * this meeting - title, agenda, project, the people still in it, the same
 * slot a week on - whose meeting joins this one's series, so the tasks still
 * open carry over to it.
 */
export function ScheduleFollowUpButton({
  workspaceId,
  meeting,
  participants,
  onCreated,
}: {
  workspaceId: string;
  meeting: Meeting;
  participants: readonly MeetingParticipant[];
  onCreated?: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <NewMeetingDialog
      workspaceId={workspaceId}
      onCreated={onCreated}
      scheduleDefaults={followUpScheduleDraft(meeting)}
      followUp={{
        meetingId: meeting.id,
        title: meeting.title,
        description: meeting.description,
        projectId: meeting.project_id || undefined,
        attendeeUserIds: followUpAttendeeIds(participants, meeting.host_user_id),
      }}
      trigger={
        <Button type="button" size="sm" variant="outline">
          <CalendarPlus aria-hidden />
          {t("meetings.followUp.action")}
        </Button>
      }
    />
  );
}
