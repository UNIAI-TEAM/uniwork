"use client";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AvatarGroup, AvatarGroupCount } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingLocale } from "./meeting-datetime";
import { requestDisplayName } from "./meeting-join-request-row";
import { MeetingPersonAvatar } from "./meeting-person";
import { usePendingJoinRequests } from "./use-pending-join-requests";

const PREVIEW_AVATARS = 4;

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
  const { t, i18n } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);

  if (count === 0) return null;

  const names = pending.map(requestDisplayName);
  const nameList = new Intl.ListFormat(meetingLocale(i18n.language), {
    style: "long",
    type: "conjunction",
  }).format(names);
  const shown = pending.slice(0, PREVIEW_AVATARS);
  const overflow = count - shown.length;
  const preview = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body font-medium text-foreground">{t("meetings.unconfirmedUsers", { count })}</span>
        <span className="line-clamp-2 text-caption text-muted-foreground">{nameList}</span>
      </span>
      <AvatarGroup className="*:data-[slot=avatar]:ring-muted">
        {shown.map((request) => (
          <MeetingPersonAvatar key={request.id} name={requestDisplayName(request)} size="sm" />
        ))}
        {overflow > 0 ? (
          <AvatarGroupCount className="size-6 bg-background text-caption text-muted-foreground ring-muted">
            {t("meetings.moreParticipantsShort", { count: overflow })}
          </AvatarGroupCount>
        ) : null}
      </AvatarGroup>
    </>
  );
  const previewClassName =
    "flex w-full min-w-0 flex-col items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-left";

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
          {t("meetings.waitingToJoin")}
        </h2>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
          {t("meetings.waitingToJoinHostHint")}
        </span>
      </div>

      {onViewAll ? (
        <Button
          type="button"
          variant="ghost"
          className={cn(
            previewClassName,
            "h-auto whitespace-normal font-normal hover:bg-muted/80",
          )}
          onClick={onViewAll}
        >
          {preview}
        </Button>
      ) : (
        <div className={previewClassName}>{preview}</div>
      )}

      {onViewAll ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto w-full justify-center gap-1 py-1.5 text-brand hover:bg-transparent hover:text-brand"
          onClick={onViewAll}
        >
          {t("meetings.viewAllJoinRequestsCount", { count })}
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
