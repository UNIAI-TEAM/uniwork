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
}: {
  workspaceId: string;
  meeting: Meeting;
  invitations: MeetingInvitation[];
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-8 space-y-2" aria-labelledby="host-panel-heading">
      <h2 id="host-panel-heading" className="text-body font-semibold text-foreground">
        {t("meetings.hostPanel")}
      </h2>
      <MeetingParticipantsSection workspaceId={workspaceId} meeting={meeting} invitations={invitations} canManage />
      <MeetingJoinRequestsPanel meetingId={meeting.id} />
      <MeetingInviteLinksSection meetingId={meeting.id} />
      <TransferHostDialog workspaceId={workspaceId} meeting={meeting} />
    </section>
  );
}
