"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingJoinRequestRow } from "./meeting-join-request-row";
import { useJoinRequestActions } from "./use-join-request-actions";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export function MeetingWaitingToJoinOverlay({
  meetingId,
  onViewAll,
  forceOpen,
  onForceOpenHandled,
  className,
}: {
  meetingId: string;
  onViewAll?: () => void;
  /** Header admit button sets this to surface the card again after dismiss. */
  forceOpen?: boolean;
  onForceOpenHandled?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { approveOne, rejectOne, approving, rejecting } = useJoinRequestActions(meetingId);
  const [dismissed, setDismissed] = useState(false);
  const prevCountRef = useRef(count);

  useEffect(() => {
    if (count > prevCountRef.current) {
      setDismissed(false);
    }
    prevCountRef.current = count;
  }, [count]);

  useEffect(() => {
    if (forceOpen) {
      setDismissed(false);
      onForceOpenHandled?.();
    }
  }, [forceOpen, onForceOpenHandled]);

  if (count === 0 || dismissed) return null;

  const first = pending[0];
  if (!first) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="waiting-to-join-title"
      aria-describedby="waiting-to-join-desc"
      className={cn(
        "absolute top-3 right-3 z-20 w-[min(100%,20rem)] rounded-2xl bg-surface/95 p-4 shadow-lg ring-1 ring-border backdrop-blur-sm",
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="waiting-to-join-title" className="text-body font-semibold text-foreground">
            {t("meetings.waitingToJoin")}
          </h2>
          <p id="waiting-to-join-desc" className="text-caption text-muted-foreground">
            {t("meetings.waitingToJoinHostHint")}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 rounded-full"
          aria-label={t("common.close")}
          onClick={() => setDismissed(true)}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button type="button" disabled={approving} onClick={() => approveOne(first.id)}>
          {t("meetings.approve")}
        </Button>
        <Button type="button" variant="outline" disabled={rejecting} onClick={() => rejectOne(first.id)}>
          {t("meetings.reject")}
        </Button>
      </div>

      <MeetingJoinRequestRow
        request={first}
        variant="overlay"
        approving={approving}
        rejecting={rejecting}
        onApprove={() => approveOne(first.id)}
        onReject={() => rejectOne(first.id)}
      />

      {count > 1 && onViewAll ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 h-8 w-full justify-between px-2 text-brand hover:text-brand"
          onClick={onViewAll}
        >
          {t("meetings.viewAllJoinRequestsCount", { count })}
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
