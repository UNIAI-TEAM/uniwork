"use client";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { MeetingInviteLinksSection } from "./meeting-invite-links-section";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingParticipantsSection } from "./meeting-participants-section";
import { TransferHostDialog } from "./transfer-host-dialog";

export function MeetingHostPanel({
  workspaceId,
  meeting,
  invitations,
  showJoinRequests = true,
}: {
  workspaceId: string;
  meeting: Meeting;
  invitations: MeetingInvitation[];
  showJoinRequests?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6"
      aria-label={t("meetings.hostPanel")}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <MeetingParticipantsSection workspaceId={workspaceId} meeting={meeting} invitations={invitations} canManage />
        {showJoinRequests ? <MeetingJoinRequestsPanel meetingId={meeting.id} compact /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <MeetingInviteLinksSection meetingId={meeting.id} />
        <TransferHostDialog workspaceId={workspaceId} meeting={meeting} />
      </div>
    </section>
  );
}
