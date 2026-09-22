"use client";
import { Check, CircleHelp, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRespondInvitation } from "@uniwork/core/meetings";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";

type Answer = "ACCEPTED" | "TENTATIVE" | "DECLINED";

const ANSWERS: { value: Answer; labelKey: string; icon: LucideIcon }[] = [
  { value: "ACCEPTED", labelKey: "meetings.accept", icon: Check },
  { value: "TENTATIVE", labelKey: "meetings.tentative", icon: CircleHelp },
  { value: "DECLINED", labelKey: "meetings.decline", icon: X },
];

/**
 * The viewer's answer to their invitation, as one segmented control: the three
 * answers stay on screen, the saved one sits in the brand wash. It never
 * competes with "Vào phòng họp" — that is the only filled brand button here.
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
  const current = rsvp.isPending ? rsvp.variables?.response : invitation.response_status;

  const respond = (response: Answer) => {
    if (response === invitation.response_status) return;
    rsvp.mutate(
      { invitationId: invitation.id, response },
      { onError: (err) => toastApiError(err, t("common.error")) },
    );
  };

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <span id={`rsvp-${invitation.id}`} className="text-label text-muted-foreground">
        {t("meetings.rsvp")}
      </span>
      <div
        role="group"
        aria-labelledby={`rsvp-${invitation.id}`}
        className="inline-flex items-center gap-0.5 rounded-lg border border-input bg-background p-0.5 dark:bg-input/30"
      >
        {ANSWERS.map(({ value, labelKey, icon: Icon }) => {
          const chosen = current === value;
          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={chosen ? "brandSubtle" : "ghost"}
              aria-pressed={chosen}
              disabled={rsvp.isPending}
              className={cn("rounded-md", !chosen && "text-muted-foreground")}
              onClick={() => respond(value)}
            >
              <Icon aria-hidden />
              {t(labelKey)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
