"use client";

import { useEffect, useRef, type FocusEvent, type ReactNode } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingWaitingToJoinCard } from "./meeting-waiting-to-join-card";

function NoticeIconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The host's "someone is at the door" panel, dropped just under the stage
 * header (UNI-860). It lives inside the room — never over the control bar,
 * the side panel or the stage's own corner — in the room's dark palette, and
 * carries the decision itself: decline, admit, or admit everyone. Whether it
 * shows, the chime and where focus goes after it closes belong to the header
 * chip that owns it. The chip's live region is the one announcement.
 */
export function MeetingJoinRequestNotice({
  meetingId,
  muted,
  onToggleMuted,
  onHide,
  onOpenPeople,
  onFocusWithinChange,
}: {
  meetingId: string;
  muted: boolean;
  onToggleMuted: () => void;
  /** Hides the panel until someone new knocks (the × button and Escape). */
  onHide: () => void;
  onOpenPeople?: () => void;
  /** Lets the owner hand focus back when the panel goes away under it. */
  onFocusWithinChange?: (inside: boolean) => void;
}) {
  const { t } = useTranslation();

  const panelRef = useRef<HTMLElement>(null);
  const hideRef = useRef(onHide);
  hideRef.current = onHide;
  // Escape from anywhere inside the panel closes it, as for any popover.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      hideRef.current();
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, []);
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusWithinChange?.(false);
  };

  return (
    <section
      aria-label={t("meetings.waitingToJoin")}
      data-testid="meeting-join-request-notice"
      ref={panelRef}
      onFocus={() => onFocusWithinChange?.(true)}
      onBlur={onBlur}
      className={cn(
        // `dark` keeps the panel in the stage's palette whatever the app theme.
        "dark absolute inset-x-3 top-full z-30 mt-2 rounded-2xl bg-popover p-4 text-popover-foreground shadow-floating ring-1 ring-border",
        "sm:left-auto sm:w-[min(22rem,calc(100%-1.5rem))] [@media(max-height:500px)]:p-3",
        "animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none",
      )}
    >
      <MeetingWaitingToJoinCard
        meetingId={meetingId}
        onViewAll={onOpenPeople}
        headerActions={
          <>
            {/* One fixed name; the pressed state says whether it is on. */}
            <NoticeIconButton label={t("meetings.joinRequestChime")} pressed={!muted} onClick={onToggleMuted}>
              {muted ? <BellOff aria-hidden className="size-4" /> : <Bell aria-hidden className="size-4" />}
            </NoticeIconButton>
            <NoticeIconButton label={t("meetings.joinRequestNoticeDismiss")} onClick={onHide}>
              <X aria-hidden className="size-4" />
            </NoticeIconButton>
          </>
        }
      />
    </section>
  );
}
