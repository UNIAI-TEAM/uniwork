"use client";
import { useTranslation } from "react-i18next";
import { useRespondInvitation } from "@uniwork/core/meetings";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { MeetingRsvpBadge } from "./meeting-status-badge";

export function MeetingRsvpBar({ meetingId, invitation }: { meetingId: string; invitation: MeetingInvitation }) {
  const { t } = useTranslation();
  const rsvp = useRespondInvitation(meetingId);
  const pending = invitation.response_status === "PENDING";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-label text-muted-foreground">{t("meetings.rsvp")}</span>
      {pending ? (
        <>
          <Button size="sm" disabled={rsvp.isPending} onClick={() => rsvp.mutate({ invitationId: invitation.id, response: "ACCEPTED" })}>
            {t("meetings.accept")}
          </Button>
          <Button size="sm" variant="outline" disabled={rsvp.isPending} onClick={() => rsvp.mutate({ invitationId: invitation.id, response: "TENTATIVE" })}>
            {t("meetings.tentative")}
          </Button>
          <Button size="sm" variant="outline" disabled={rsvp.isPending} onClick={() => rsvp.mutate({ invitationId: invitation.id, response: "DECLINED" })}>
            {t("meetings.decline")}
          </Button>
        </>
      ) : (
        <MeetingRsvpBadge status={invitation.response_status} />
      )}
    </div>
  );
}
