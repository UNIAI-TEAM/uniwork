"use client";

import { useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingJoinRequestNotice } from "./meeting-join-request-notice";
import { leaveShareFullscreen } from "./screen-share";
import { useJoinRequestChime } from "./use-join-request-chime";
import { usePendingJoinRequests } from "./use-pending-join-requests";

function focusElement(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1;
  target.focus();
  return true;
}

/** Where focus goes when the panel closes and the chip is gone too. */
function focusStageHeading() {
  focusElement(document.querySelector<HTMLElement>("[data-stage-heading]"));
}

/** The people tab's waiting list, when the panel handed over to it. */
function focusWaitingList(): boolean {
  return focusElement(document.querySelector<HTMLElement>("#waiting-admission-heading button"));
}

/**
 * The host's count of people at the door, plus the panel that lets them in.
 * The chip states how many are waiting and opens the people tab; admitting
 * happens in the panel. The panel steps aside while the people tab is open —
 * it shows the same list — and counts those knocks as seen.
 */
export function MeetingAdmitGuestsButton({
  meetingId,
  onOpenPeople,
  peopleOpen = false,
  className,
}: {
  meetingId: string;
  /** Pressing the chip (and "view all") lands on the people tab with the full list. */
  onOpenPeople?: () => void;
  /** The people tab is on screen: the panel would only repeat it. */
  peopleOpen?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { muted, setMuted } = useJoinRequestChime(pending);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const chipRef = useRef<HTMLButtonElement>(null);
  const focusInPanel = useRef(false);

  const hideAll = () => setSeen(new Set(pending.map((r) => r.id)));
  useEffect(() => {
    if (peopleOpen && pending.some((r) => !seen.has(r.id))) setSeen(new Set(pending.map((r) => r.id)));
  }, [peopleOpen, pending, seen]);

  const panelVisible = count > 0 && !peopleOpen && pending.some((r) => !seen.has(r.id));

  // A share watched full screen is the only thing in view: the panel, and an
  // open people tab too, sit behind it, and the guest waits unseen. Once per
  // knock as it arrives, so a host who goes back to full screen is not pulled
  // out again by the same guest.
  const leftFor = useRef(new Set<string>());
  useEffect(() => {
    const fresh = pending.filter((r) => !leftFor.current.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) leftFor.current.add(r.id);
    leaveShareFullscreen();
  }, [pending]);

  // The panel can vanish under the keyboard (hidden, the last person let in):
  // focus goes back to the chip, or to the stage heading if the chip went too.
  // When "view all" handed over to the people tab, focus follows into its list
  // (an already-open side panel does not move focus by itself).
  const wasVisible = useRef(panelVisible);
  useEffect(() => {
    const closed = wasVisible.current && !panelVisible;
    wasVisible.current = panelVisible;
    if (!closed || !focusInPanel.current) return;
    focusInPanel.current = false;
    if (peopleOpen && focusWaitingList()) return;
    if (chipRef.current) chipRef.current.focus();
    else focusStageHeading();
  }, [panelVisible, peopleOpen]);

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
        ref={chipRef}
        type="button"
        size="sm"
        variant="successSolid"
        aria-label={accessibleName}
        className={cn("h-8 gap-1.5 rounded-full px-3", className)}
        onClick={onOpenPeople}
      >
        <UserPlus aria-hidden className="size-3.5" />
        <span className="max-w-[10rem] truncate">{label}</span>
      </Button>
      {/* Positioned against the stage header, just under it. */}
      {panelVisible ? (
        <MeetingJoinRequestNotice
          meetingId={meetingId}
          muted={muted}
          onToggleMuted={() => setMuted(!muted)}
          onHide={hideAll}
          onOpenPeople={onOpenPeople}
          onFocusWithinChange={(inside) => {
            focusInPanel.current = inside;
          }}
        />
      ) : null}
    </>
  );
}
