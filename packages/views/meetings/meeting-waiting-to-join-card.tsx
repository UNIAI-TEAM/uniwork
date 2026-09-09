"use client";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingJoinRequestRow } from "./meeting-join-request-row";
import { useJoinRequestActions } from "./use-join-request-actions";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export function MeetingWaitingToJoinCard({
  meetingId,
  onViewAll,
  className,
}: {
  meetingId: string;
  /** Leads to the people tab, which holds the full list and per-guest actions. */
  onViewAll?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { approveOne, rejectOne, approving, rejecting } = useJoinRequestActions(meetingId);

  const first = pending[0];
  if (!first) return null;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 truncate text-body font-semibold text-foreground">
          {t("meetings.waitingToJoin")}
        </h2>
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
          {t("meetings.waitingToJoinHostHint")}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          className="rounded-full"
          disabled={approving}
          onClick={() => approveOne(first.id)}
        >
          {t("meetings.approve")}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="rounded-full"
          disabled={rejecting}
          onClick={() => rejectOne(first.id)}
        >
          {t("meetings.reject")}
        </Button>
      </div>

      <div className="mt-2">
        <MeetingJoinRequestRow
          request={first}
          variant="overlay"
          approving={approving}
          rejecting={rejecting}
          onApprove={() => approveOne(first.id)}
          onReject={() => rejectOne(first.id)}
        />
      </div>

      {onViewAll ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-8 w-full justify-between px-2 text-brand hover:text-brand"
          onClick={onViewAll}
        >
          {t("meetings.viewAllJoinRequestsCount", { count })}
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
