"use client";

import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { useJoinRequestActions } from "./use-join-request-actions";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export function MeetingAdmitGuestsButton({
  meetingId,
  onOpenOverlay,
  className,
}: {
  meetingId: string;
  /** Re-surfaces the waiting-to-join card after the host dismissed it. */
  onOpenOverlay?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { approveOne, approving } = useJoinRequestActions(meetingId);

  if (count === 0) return null;

  const label = t("meetings.admitGuests", { count });

  const handleClick = () => {
    onOpenOverlay?.();
    const first = pending[0];
    if (!first) return;
    approveOne(first.id);
  };

  return (
    <Button
      type="button"
      size="sm"
      className={cn(
        "rounded-full bg-success text-white shadow-sm hover:bg-success/90 focus-visible:ring-success/30",
        className,
      )}
      disabled={approving}
      aria-label={label}
      onClick={handleClick}
    >
      <UserPlus aria-hidden className="size-4" />
      <span>{label}</span>
    </Button>
  );
}
