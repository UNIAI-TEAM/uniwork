"use client";

import type { Meeting } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { MeetingInviteLinksSection } from "./meeting-invite-links-section";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingParticipantsSection } from "./meeting-participants-section";

export function MeetingHostPanel({
  workspaceId,
  meeting,
  invitations,
}: {
  workspaceId: string;
  meeting: Meeting;
  invitations: MeetingInvitation[];
}) {
  return (
    <div className="space-y-4" aria-label="host controls">
      <MeetingJoinRequestsPanel meetingId={meeting.id} compact />
      <MeetingParticipantsSection
        workspaceId={workspaceId}
        meeting={meeting}
        invitations={invitations}
        canManage
        showTransferHost
      />
      <MeetingInviteLinksSection meetingId={meeting.id} />
    </div>
  );
}
