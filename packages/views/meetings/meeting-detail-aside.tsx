"use client";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { useMembers } from "@uniwork/core/workspaces";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { MeetingInviteLinksSection } from "./meeting-invite-links-section";
import { PanelCard } from "../common/panel-card";
import { MeetingParticipantsSection } from "./meeting-participants-section";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-label text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-body text-foreground">{children}</dd>
    </div>
  );
}

/** Facts that rarely change: who is in, how guests get in, and the record. */
export function MeetingDetailAside({
  workspaceId,
  meeting,
  invitations,
  canHost,
}: {
  workspaceId: string;
  meeting: Meeting;
  invitations: MeetingInvitation[];
  canHost: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const creator = members?.find((m) => m.user_id === meeting.created_by)?.display_name ?? meeting.created_by;
  const timezone = meeting.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const createdAt = meeting.created_at ? formatMeetingStart(meeting.created_at, meetingLocale(i18n.language)) : null;
  const rosterOpen = meeting.status === "SCHEDULED" || meeting.status === "IN_PROGRESS" || !meeting.status;
  const canMutateRoster = canHost && rosterOpen;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MeetingParticipantsSection
        workspaceId={workspaceId}
        meeting={meeting}
        invitations={invitations}
        canManage={canMutateRoster}
        showTransferHost={canMutateRoster}
      />
      {canHost ? <MeetingInviteLinksSection meetingId={meeting.id} canCreate={canMutateRoster} /> : null}
      <PanelCard id="details-heading" icon={Info} title={t("meetings.details")}>
        <dl className="-my-2 divide-y divide-border">
          <DetailRow label={t("meetings.timezone")}>{timezone}</DetailRow>
          <DetailRow label={t("meetings.meetingType")}>
            {meeting.meeting_type === "INSTANT" ? t("meetings.typeInstant") : t("meetings.typeScheduled")}
          </DetailRow>
          <DetailRow label={t("meetings.createdBy")}>{creator}</DetailRow>
          {createdAt ? (
            <DetailRow label={t("meetings.createdAt")}>
              <span className="tabular-nums">{createdAt}</span>
            </DetailRow>
          ) : null}
        </dl>
      </PanelCard>
    </div>
  );
}
