"use client";
import { useId } from "react";
import { NotebookPen, UserCheck, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useUpdateMeetingParticipant } from "@uniwork/core/meetings/attendance";
import type { MeetingParticipant } from "@uniwork/core/types";
import { DropdownMenuItem, DropdownMenuSeparator } from "@uniwork/ui/components/ui/dropdown-menu";
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

/**
 * Host/admin menu entries that set who votes and who clerks, as their own
 * group: the toast names the person and the role they now hold.
 *
 * A finalized roll locks standing (the server answers 409 until it is
 * reopened), so the switch is disabled with the reason under it; the
 * secretary role stays open. The host's own row gets only its standing, plus
 * lifting a secretary role it should not hold.
 */
export function MeetingDutyMenuItems({
  meetingId,
  participant,
  name,
  separatorBefore = false,
  rollFinalized = false,
  standingOnly = false,
}: {
  meetingId: string;
  participant: MeetingParticipant;
  name: string;
  /** Set when other entries come first in the menu. */
  separatorBefore?: boolean;
  /** The attendance roll is finalized; from the caller's useAttendanceFinalized. */
  rollFinalized?: boolean;
  /** The host's row: standing only, never handing it the secretary role. */
  standingOnly?: boolean;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const update = useUpdateMeetingParticipant(meetingId);
  const observer = participant.standing === "OBSERVER";
  const secretary = participant.is_secretary === true;
  const offerSecretary = participant.principal_type === "USER" && (!standingOnly || secretary);
  // The menu closes on click and unmounts these items, which drops mutate()'s
  // per-call callbacks; the promise still settles, so the toast hangs off it.
  const run = (patch: { standing?: "MEMBER" | "OBSERVER"; is_secretary?: boolean }, done: string) => {
    update.mutateAsync({ participantId: participant.id, ...patch }).then(
      () => toast.success(t(done, { name })),
      (err: unknown) => toastApiError(err, t("common.error")),
    );
  };
  return (
    <>
      {separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        disabled={update.isPending || rollFinalized}
        aria-describedby={rollFinalized ? hintId : undefined}
        onClick={() =>
          observer
            ? run({ standing: "MEMBER" }, "meetings.governance.madeMember")
            : run({ standing: "OBSERVER" }, "meetings.governance.madeObserver")
        }
      >
        {observer ? <UserCheck aria-hidden className="size-4" /> : <UserRound aria-hidden className="size-4" />}
        {observer ? t("meetings.governance.makeMember") : t("meetings.governance.makeObserver")}
      </DropdownMenuItem>
      {rollFinalized ? (
        // Outside the item: a disabled item is faded, and the reason must stay readable.
        <p id={hintId} className="max-w-56 pr-1.5 pb-1 pl-7 text-caption text-muted-foreground">
          {t("meetings.governance.standingLockedHint")}
        </p>
      ) : null}
      {offerSecretary ? (
        <DropdownMenuItem
          disabled={update.isPending}
          onClick={() =>
            secretary
              ? run({ is_secretary: false }, "meetings.governance.secretaryRemoved")
              : run({ is_secretary: true }, "meetings.governance.secretaryAssigned")
          }
        >
          <NotebookPen aria-hidden className="size-4" />
          {secretary ? t("meetings.governance.removeSecretary") : t("meetings.governance.assignSecretary")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
