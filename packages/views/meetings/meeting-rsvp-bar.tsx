"use client";
import { useState } from "react";
import { Check, CircleHelp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRespondInvitation } from "@uniwork/core/meetings";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingRsvpBadge } from "./meeting-status-badge";

/**
 * The viewer's answer to their invitation. Pending shows the three choices;
 * an answer collapses to its badge with a quiet way back to the choices.
 */
export function MeetingRsvpBar({
  meetingId,
  invitation,
  className,
}: {
  meetingId: string;
  invitation: MeetingInvitation;
  className?: string;
}) {
  const { t } = useTranslation();
  const rsvp = useRespondInvitation(meetingId);
  const [editing, setEditing] = useState(false);
  const pending = invitation.response_status === "PENDING";
  const choosing = pending || editing;

  const respond = (response: "ACCEPTED" | "TENTATIVE" | "DECLINED") =>
    rsvp.mutate({ invitationId: invitation.id, response }, { onSuccess: () => setEditing(false) });

  return (
    <div
      role="group"
      aria-label={t("meetings.rsvp")}
      className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}
    >
      <span className="text-label text-muted-foreground">{t("meetings.rsvp")}</span>
      {choosing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="brand" disabled={rsvp.isPending} onClick={() => respond("ACCEPTED")}>
            <Check aria-hidden />
            {t("meetings.accept")}
          </Button>
          <Button size="sm" variant="outline" disabled={rsvp.isPending} onClick={() => respond("TENTATIVE")}>
            <CircleHelp aria-hidden />
            {t("meetings.tentative")}
          </Button>
          <Button size="sm" variant="outline" disabled={rsvp.isPending} onClick={() => respond("DECLINED")}>
            <X aria-hidden />
            {t("meetings.decline")}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <MeetingRsvpBadge status={invitation.response_status} />
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setEditing(true)}>
            {t("meetings.changeRsvp")}
          </Button>
        </div>
      )}
    </div>
  );
}
