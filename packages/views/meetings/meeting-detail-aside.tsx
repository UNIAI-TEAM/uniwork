"use client";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { meetingTimeZoneLabel } from "./meeting-detail-format";
import { MeetingInviteLinksSection } from "./meeting-invite-links-section";
import { MeetingParticipantsSection } from "./meeting-participants-section";
import { useMemberIndex } from "./use-member-index";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-label text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-body text-foreground">{children}</dd>
    </div>
  );
}

function rosterOpen(meeting: Meeting): boolean {
  return meeting.status === "SCHEDULED" || meeting.status === "IN_PROGRESS" || !meeting.status;
}

/**
 * Who is in. Rendered apart from the rest of the aside so small screens can
 * show it right under the hero, before summary and notes.
 */
export function MeetingDetailRoster({
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
  const canMutateRoster = canHost && rosterOpen(meeting);
  return (
    <MeetingParticipantsSection
      workspaceId={workspaceId}
      meeting={meeting}
      invitations={invitations}
      canManage={canMutateRoster}
      showTransferHost={canMutateRoster}
    />
  );
}

/** Facts that rarely change: how guests get in, and the record. */
export function MeetingDetailAside({
  workspaceId,
  meeting,
  canHost,
}: {
  workspaceId: string;
  meeting: Meeting;
  canHost: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { memberOf, loaded } = useMemberIndex(workspaceId);
  const creator = memberOf(meeting.created_by)?.display_name ?? (loaded ? t("meetings.formerMember") : null);
  const timezone = meetingTimeZoneLabel(
    meeting.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    i18n.language,
    new Date(meeting.starts_at),
  );
  const createdAt = meeting.created_at ? formatMeetingStart(meeting.created_at, meetingLocale(i18n.language)) : null;
  const open = rosterOpen(meeting);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Once the meeting is over its links read as closed: nothing to revoke or create. */}
      {canHost ? <MeetingInviteLinksSection meetingId={meeting.id} canCreate={open} /> : null}
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
