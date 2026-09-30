"use client";
import { NotebookPen, UserCheck, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useUpdateMeetingParticipant } from "@uniwork/core/meetings/attendance";
import type { MeetingParticipant } from "@uniwork/core/types";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { toastApiError } from "../toast-api-error";

/** The chip a participant's duties earn beside their name; members carry none. */
export function dutyRole(
  p: { standing?: string; is_secretary?: boolean; principal_type: string } | undefined,
): "secretary" | "observer" | null {
  if (!p) return null;
  if (p.is_secretary) return "secretary";
  if (p.standing === "OBSERVER") return "observer";
  return null;
}

/** Host/admin menu entries that set who votes and who clerks. */
export function MeetingDutyMenuItems({
  meetingId,
  participant,
}: {
  meetingId: string;
  participant: MeetingParticipant;
}) {
  const { t } = useTranslation();
  const update = useUpdateMeetingParticipant(meetingId);
  const observer = participant.standing === "OBSERVER";
  const secretary = participant.is_secretary === true;
  const run = (patch: { standing?: "MEMBER" | "OBSERVER"; is_secretary?: boolean }) =>
    update.mutate(
      { participantId: participant.id, ...patch },
      {
        onSuccess: () => toast.success(t("meetings.governance.rolesUpdated")),
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  return (
    <>
      <DropdownMenuItem disabled={update.isPending} onClick={() => run({ standing: observer ? "MEMBER" : "OBSERVER" })}>
        {observer ? <UserCheck aria-hidden className="size-4" /> : <UserRound aria-hidden className="size-4" />}
        {observer ? t("meetings.governance.makeMember") : t("meetings.governance.makeObserver")}
      </DropdownMenuItem>
      {participant.principal_type === "USER" ? (
        <DropdownMenuItem disabled={update.isPending} onClick={() => run({ is_secretary: !secretary })}>
          <NotebookPen aria-hidden className="size-4" />
          {secretary ? t("meetings.governance.removeSecretary") : t("meetings.governance.assignSecretary")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
