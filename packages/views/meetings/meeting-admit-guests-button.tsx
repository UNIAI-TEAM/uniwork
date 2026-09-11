"use client";

import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@uniwork/ui/components/ui/hover-card";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingWaitingToJoinCard } from "./meeting-waiting-to-join-card";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export function MeetingAdmitGuestsButton({
  meetingId,
  onOpenPeople,
  className,
}: {
  meetingId: string;
  /** Pressing the chip (and "view all") lands on the people tab with the full list. */
  onOpenPeople?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { count } = usePendingJoinRequests(meetingId);

  // The live region stays mounted across the count going back to zero, so a
  // host on a screen reader hears the next guest arrive instead of nothing.
  const announcement = (
    <span role="status" aria-live="polite" className="sr-only">
      {count > 0 ? t("meetings.joinRequestsPendingTitle", { count }) : ""}
    </span>
  );

  if (count === 0) return announcement;

  const label = t("meetings.admitGuests", { count });

  return (
    <>
      {announcement}
      <HoverCard>
        <HoverCardTrigger
          delay={120}
          closeDelay={220}
          render={
            <Button
              type="button"
              size="sm"
              aria-label={label}
              className={cn(
                "h-8 gap-1.5 rounded-full px-3 !border-transparent !bg-success !text-background hover:!bg-success/90 focus-visible:ring-success/40",
                className,
              )}
              onClick={onOpenPeople}
            />
          }
        >
          <UserPlus aria-hidden className="size-3.5" />
          <span className="max-w-[10rem] truncate">{label}</span>
        </HoverCardTrigger>
        <HoverCardContent
          side="bottom"
          align="end"
          sideOffset={10}
          // `dark` keeps the panel in the meeting bar's palette: Base UI
          // portals the popup to <body>, away from the dark stage wrapper.
          className="dark w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-border"
        >
          <MeetingWaitingToJoinCard meetingId={meetingId} onViewAll={onOpenPeople} />
        </HoverCardContent>
      </HoverCard>
    </>
  );
}
