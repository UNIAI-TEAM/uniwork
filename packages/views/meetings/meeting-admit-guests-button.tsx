"use client";

import { useEffect, useRef } from "react";
import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { leaveShareFullscreen } from "./screen-share";
import { useJoinRequestChime } from "./use-join-request-chime";
import { usePendingJoinRequests } from "./use-pending-join-requests";

/**
 * The host's count of people at the door. The chip states how many are
 * waiting and opens the people tab, which holds the full list; each knock
 * also lands as a card with "Cho vào" in the stage's notice stack
 * (MeetingStageToasts, UNI-2285 E). The chime and the live region live here.
 */
export function MeetingAdmitGuestsButton({
  meetingId,
  onOpenPeople,
  className,
}: {
  meetingId: string;
  /** Pressing the chip lands on the people tab with the full list. */
  onOpenPeople?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  useJoinRequestChime(pending);

  // A share watched full screen is the only thing in view: the stage's cards,
  // and an open people tab too, sit behind it, and the guest waits unseen.
  // Once per knock as it arrives, so a host who goes back to full screen is
  // not pulled out again by the same guest.
  const leftFor = useRef(new Set<string>());
  useEffect(() => {
    const fresh = pending.filter((r) => !leftFor.current.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) leftFor.current.add(r.id);
    leaveShareFullscreen();
  }, [pending]);

  // The live region stays mounted across the count going back to zero, so a
  // host on a screen reader hears the next guest arrive instead of nothing.
  const announcement = (
    <span role="status" aria-live="polite" className="sr-only">
      {count > 0 ? t("meetings.joinRequestsPendingTitle", { count }) : ""}
    </span>
  );

  if (count === 0) return announcement;

  const label = t("meetings.joinRequestsWaitingChip", { count });
  // The name starts with what is on screen and adds what pressing does.
  const accessibleName = t("meetings.joinRequestsWaitingChipAction", { count });

  return (
    <>
      {announcement}
      <Button
        type="button"
        size="sm"
        variant="successSolid"
        aria-label={accessibleName}
        // Where the stage's knock cards hand focus once the last one is decided.
        data-admit-guests
        className={cn("h-8 gap-1.5 rounded-full px-2.5 @4xl/stagehead:px-3", className)}
        onClick={onOpenPeople}
      >
        <UserPlus aria-hidden className="size-3.5" />
        {/* A narrow header shows the icon and the count, so the meeting title keeps its room; the name says it all. */}
        <span aria-hidden className="tabular-nums @4xl/stagehead:hidden" data-testid="meeting-admit-count">
          {count}
        </span>
        <span className="hidden max-w-[10rem] truncate @4xl/stagehead:inline">{label}</span>
      </Button>
    </>
  );
}
