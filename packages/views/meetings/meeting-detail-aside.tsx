"use client";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { useMembers } from "@uniwork/core/workspaces";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { meetingTimeZoneLabel } from "./meeting-detail-format";
import { MeetingInviteLinksSection } from "./meeting-invite-links-section";
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
  const creator =
    members?.find((m) => m.user_id === meeting.created_by)?.display_name ?? (members ? t("meetings.formerMember") : null);
  const timezone = meetingTimeZoneLabel(
    meeting.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    i18n.language,
  );
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
      <PanelCard id="details-heading" icon={Info} iconTone={moduleTone("meetings")} title={t("meetings.details")}>
        <dl className="-my-2 divide-y divide-border">
          <DetailRow label={t("meetings.timezone")}>{timezone}</DetailRow>
          {meeting.allow_join_request !== undefined ? (
            <DetailRow label={t("meetings.whoCanJoin")}>
              {t(meeting.allow_join_request ? "meetings.joinRequestOpen" : "meetings.joinRequestClosed")}
            </DetailRow>
          ) : null}
          {creator ? <DetailRow label={t("meetings.createdBy")}>{creator}</DetailRow> : null}
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
