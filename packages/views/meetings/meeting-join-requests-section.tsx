"use client";

import { useState } from "react";
import { Bell, BellOff, ChevronDown } from "lucide-react";
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
import { useJoinRequestChimeSetting } from "./use-join-request-chime";
import { usePendingJoinRequests } from "./use-pending-join-requests";

/**
 * The host's one card for people knocking: up to two faces, who waits first
 * and how many more, and "Admit" for all of them; the chevron unfolds each
 * person's own row.
 */
export function MeetingJoinRequestsSection({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { approveOne, rejectOne, admitAll, approving, isApproving, isRejecting } = useJoinRequestActions(meetingId);
  const avatarOf = useUserAvatarOf();
  const [open, setOpen] = useState(false);
  // The toggle only: the chip in the stage header plays the chime.
  const { muted, setMuted } = useJoinRequestChimeSetting();

  if (count === 0) return null;
  const only = pending.length === 1 ? pending[0] : undefined;
  const first = pending[0];

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
          {/* Who waits first, then how many more; two lines before anything is cut, so the name always shows. */}
          <h3
            id="waiting-admission-heading"
            className="line-clamp-2 min-w-0 flex-1 text-label font-semibold break-words text-warning-soft-foreground"
          >
            {first ? requestDisplayName(first) : ""}{" "}
            {count > 1 ? t("meetings.panel.people.waitingOthers", { count: count - 1 }) : t("meetings.panel.people.waitingAlone")}
          </h3>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 rounded-[10px] bg-foreground px-3 text-caption font-semibold text-background hover:bg-foreground/90"
            // Several waiting, the one button admits them all: its name says how many.
            aria-label={only ? undefined : t("meetings.panel.people.admitAll", { count: pending.length })}
            disabled={only ? isApproving(only.id) : approving}
            onClick={() => (only ? approveOne(only.id) : void admitAll(pending))}
          >
            {t("meetings.panel.people.admit")}
          </Button>
          {/* One fixed name; the pressed state says whether the knock chime is on. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-[10px] text-warning-soft-foreground hover:bg-warning-soft"
            aria-label={t("meetings.joinRequestChime")}
            aria-pressed={!muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <BellOff aria-hidden className="size-4" /> : <Bell aria-hidden className="size-4" />}
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
