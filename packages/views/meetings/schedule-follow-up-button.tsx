"use client";
import { useTranslation } from "react-i18next";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { kitButton } from "./meeting-detail/ui/kit-buttons";
import { MeetingSheet } from "./meeting-sheet";

/**
 * "Lên lịch họp tiếp" (follow-4): the meeting sheet in follow-up mode — the
 * next week's slot, the title's week moved on, the people again as members,
 * and what this meeting leaves open — whose meeting joins this one's series.
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
    <MeetingSheet
      mode="followUp"
      workspaceId={workspaceId}
      previous={meeting}
      previousParticipants={participants}
      onDone={onCreated}
      trigger={
        <Button type="button" size="lg" variant="ghost" className={cn(kitButton.base, kitButton.ghost)}>
          {t("meetings.sheet.followUpAction")}
        </Button>
      }
    />
  );
}
