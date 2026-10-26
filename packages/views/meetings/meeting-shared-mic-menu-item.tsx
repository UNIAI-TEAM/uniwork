"use client";
import { MicVocal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSetSharedMic } from "@uniwork/core/meetings/speaker-labels";
import type { MeetingParticipant } from "@uniwork/core/types";
import { DropdownMenuItem, DropdownMenuSeparator } from "@uniwork/ui/components/ui/dropdown-menu";
import { toastApiError } from "../toast-api-error";

/**
 * Clerk entry (spec 2026-10-20-meeting-scribe-agent-design §4.3, §10): this
 * participant's mic is the room's shared one, so the AI scribe tells its
 * speakers apart. The server sets the LiveKit attribute; the toast says it.
 */
export function MeetingSharedMicMenuItem({
  meetingId,
  participant,
  name,
  separatorBefore = false,
}: {
  meetingId: string;
  participant: MeetingParticipant;
  name: string;
  separatorBefore?: boolean;
}) {
  const { t } = useTranslation();
  const set = useSetSharedMic(meetingId);
  const on = participant.shared_mic === true;
  // The menu unmounts this item on click, so the toast hangs off the promise.
  const toggle = () => {
    set.mutateAsync({ participantId: participant.id, enabled: !on }).then(
      () => toast.success(t(on ? "meetings.scribe.sharedMicCleared" : "meetings.scribe.sharedMicSet", { name })),
      (err: unknown) => toastApiError(err, t("common.error")),
    );
  };
  return (
    <>
      {separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem disabled={set.isPending} onClick={toggle}>
        <MicVocal aria-hidden className="size-4" />
        {on ? t("meetings.scribe.sharedMicOff") : t("meetings.scribe.sharedMicOn")}
      </DropdownMenuItem>
    </>
  );
}
