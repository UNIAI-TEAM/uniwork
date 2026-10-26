"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingJoinRequestRow, requestDisplayName } from "./meeting-join-request-row";
import { MeetingPersonAvatar } from "./meeting-person";
import { useUserAvatarOf } from "./meeting-room-avatars";
import { useJoinRequestActions } from "./use-join-request-actions";
import { usePendingJoinRequests } from "./use-pending-join-requests";

/**
 * The host's one card for people knocking: up to two faces, the count, and
 * "Admit" for all of them; the chevron unfolds each person's own row.
 */
export function MeetingJoinRequestsSection({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { approveOne, rejectOne, admitAll, approving, isApproving, isRejecting } = useJoinRequestActions(meetingId);
  const avatarOf = useUserAvatarOf();
  const [open, setOpen] = useState(false);

  if (count === 0) return null;
  const only = pending.length === 1 ? pending[0] : undefined;

  return (
    <section className="mb-3 shrink-0" aria-labelledby="waiting-admission-heading">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2.5 rounded-[14px] bg-warning-soft/60 py-2.5 pr-2.5 pl-3 ring-1 ring-warning-soft-foreground/20 ring-inset">
          <span className="flex shrink-0">
            {pending.slice(0, 2).map((r, i) => (
              <MeetingPersonAvatar
                key={r.id}
                name={requestDisplayName(r)}
                avatarUrl={avatarOf(r.requester_user_id)}
                size={28}
                className={cn("rounded-full ring-2 ring-warning-soft", i > 0 && "-ml-2")}
              />
            ))}
          </span>
          <h3
            id="waiting-admission-heading"
            className="min-w-0 flex-1 truncate text-label font-semibold text-warning-soft-foreground"
          >
            {t("meetings.panel.people.waiting", { count })}
          </h3>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 rounded-[10px] bg-foreground px-3 text-caption font-semibold text-background hover:bg-foreground/90"
            disabled={only ? isApproving(only.id) : approving}
            onClick={() => (only ? approveOne(only.id) : void admitAll(pending))}
          >
            {t("meetings.panel.people.admit")}
          </Button>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 rounded-[10px] text-warning-soft-foreground hover:bg-warning-soft"
                aria-label={t("meetings.panel.people.showWaiting")}
              />
            }
          >
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform duration-fast motion-reduce:transition-none", open && "rotate-180")}
            />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <ul className="space-y-0.5 pt-1">
            {pending.map((r) => (
              <li key={r.id}>
                <MeetingJoinRequestRow
                  request={r}
                  variant="sidebar"
                  approving={isApproving(r.id)}
                  rejecting={isRejecting(r.id)}
                  onApprove={() => approveOne(r.id)}
                  onReject={() => rejectOne(r.id)}
                />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
