"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AvatarGroup, AvatarGroupCount } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { meetingLocale } from "./meeting-datetime";
import { MeetingJoinRequestRow, requestDisplayName } from "./meeting-join-request-row";
import { MeetingPersonAvatar } from "./meeting-person";
import { useUserAvatarOf } from "./meeting-room-avatars";
import { useJoinRequestActions } from "./use-join-request-actions";
import { usePendingJoinRequests } from "./use-pending-join-requests";

const PREVIEW_AVATARS = 4;

export function MeetingWaitingToJoinCard({
  meetingId,
  onViewAll,
  headerActions,
  className,
}: {
  meetingId: string;
  /** Leads to the people tab, which holds the full list and per-person actions. */
  onViewAll?: () => void;
  /** Small controls at the end of the heading row (sound, dismiss). */
  headerActions?: ReactNode;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { approveOne, rejectOne, admitAll, approving, rejecting } = useJoinRequestActions(meetingId);

  const first = pending[0];
  if (!first || count === 0) return null;

  return (
    // A landscape phone keeps the panel to the essentials: who, and the two
    // decisions (the header hint and the row's subtitle step aside).
    <div className={cn("flex min-w-0 flex-col gap-3 [@media(max-height:500px)]:gap-2", className)}>
      {/* The title owns the row; who can see this sits under it, so neither
          truncates when the row also carries controls. */}
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-medium text-foreground">{t("meetings.waitingToJoin")}</h2>
          <p className="text-caption text-muted-foreground [@media(max-height:500px)]:hidden">
            {t("meetings.waitingToJoinHostHint")}
          </p>
        </div>
        {headerActions ? <div className="-mt-1 -mr-1 flex shrink-0 items-center">{headerActions}</div> : null}
      </div>

      {count === 1 ? (
        <MeetingJoinRequestRow
          request={first}
          variant="overlay"
          approving={approving}
          rejecting={rejecting}
          onApprove={() => approveOne(first.id)}
          onReject={() => rejectOne(first.id)}
        />
      ) : (
        <WaitingPeoplePreview pending={pending} count={count} language={i18n.language} />
      )}

      {/* Decline sits first and quiet; admitting is the one filled action, in
          the same green as the header chip. */}
      <div className="grid grid-cols-2 gap-2">
        {count === 1 ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            disabled={rejecting}
            aria-label={t("meetings.rejectName", { name: requestDisplayName(first) })}
            onClick={() => rejectOne(first.id)}
          >
            {t("meetings.reject")}
          </Button>
        ) : (
          <Button type="button" variant="outline" className="rounded-full" onClick={onViewAll} disabled={!onViewAll}>
            {t("meetings.viewAllJoinRequestsCount", { count })}
          </Button>
        )}
        <Button
          type="button"
          variant="successSolid"
          className="rounded-full"
          disabled={approving}
          aria-label={count === 1 ? t("meetings.approveName", { name: requestDisplayName(first) }) : undefined}
          onClick={() => (count === 1 ? approveOne(first.id) : void admitAll(pending))}
        >
          {count === 1 ? t("meetings.approve") : t("meetings.admitAll")}
        </Button>
      </div>

    </div>
  );
}

function WaitingPeoplePreview({
  pending,
  count,
  language,
}: {
  pending: MeetingJoinRequest[];
  count: number;
  language: string;
}) {
  const { t } = useTranslation();
  const avatarOf = useUserAvatarOf();
  const names = pending.map(requestDisplayName);
  const nameList = new Intl.ListFormat(meetingLocale(language), {
    style: "long",
    type: "conjunction",
  }).format(names);
  const shown = pending.slice(0, PREVIEW_AVATARS);
  const overflow = count - shown.length;
  const preview = (
    <>
      {/* Avatars sit on the card, not on a muted panel: their own fill is muted. */}
      <AvatarGroup className="shrink-0 -space-x-1.5 *:data-[slot=avatar]:ring-popover">
        {shown.map((request) => (
          <MeetingPersonAvatar
            key={request.id}
            name={requestDisplayName(request)}
            avatarUrl={avatarOf(request.requester_user_id)}
            size="default"
            tone="stage"
          />
        ))}
        {overflow > 0 ? (
          <AvatarGroupCount className="size-8 text-caption ring-popover">
            {t("meetings.moreParticipantsShort", { count: overflow })}
          </AvatarGroupCount>
        ) : null}
      </AvatarGroup>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body font-medium text-foreground">{t("meetings.unconfirmedUsers", { count })}</span>
        <span className="line-clamp-2 text-caption text-muted-foreground">{nameList}</span>
      </span>
    </>
  );
  // Display only: "view all" beside it is the one way to the full list.
  return (
    <div className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border px-3 py-2.5 [@media(max-height:500px)]:py-1.5">
      {preview}
    </div>
  );
}
