"use client";

import { useEffect, useId, useRef, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Vote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingMotionBallot } from "./meeting-motion-ballot";
import { useMeetingVotePrompt } from "./use-meeting-vote-prompt";

/**
 * The stage's "your vote is needed" card, stacked above the control bar while
 * an open item waits for this person's ballot. It never takes focus when it
 * arrives: the live region announces it and the person chooses when to reach
 * for it. The announcer is a status message mounted for the life of the room
 * (portalled to the body, so the footer slot stays `:empty` while no vote is
 * due): text inserted together with a new live region is not read out. Two
 * steps (pick, then submit); afterwards it confirms in place and goes away by
 * itself. Hidden by hand (button or Escape), the ballot stays in
 * the Votes tab. It sits outside the stage's `dark` wrapper, so it carries
 * `dark` itself, like the join-request notice.
 */
export function MeetingVotePrompt({ meetingId, onOpenTab }: { meetingId: string; onOpenTab: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const { motion, recorded, dismiss, markRecorded } = useMeetingVotePrompt(meetingId);
  const panelRef = useRef<HTMLElement>(null);
  const recordedRef = useRef<HTMLParagraphElement>(null);
  const focusInside = useRef(false);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const shown = motion !== null;

  // Escape from anywhere inside the card hides it, as for any popover.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      dismissRef.current();
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [shown]);

  useEffect(() => {
    if (!shown) focusInside.current = false;
  }, [shown]);

  // The submit button unmounts with the ballot; a keyboard user who sent it
  // lands on the confirmation instead of the page body.
  useEffect(() => {
    if (recorded && focusInside.current) recordedRef.current?.focus();
  }, [recorded]);

  // One status message for the life of the room; only its text changes.
  const announcer =
    typeof document === "undefined"
      ? null
      : createPortal(
          <p role="status" className="sr-only">
            {motion && !recorded ? t("meetings.governance.votePromptAnnounce", { title: motion.title }) : ""}
          </p>,
          document.body,
        );

  if (!motion) return announcer;

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusInside.current = false;
  };

  return (
    <>
      {announcer}
      <section
        ref={panelRef}
        aria-labelledby={titleId}
        data-testid="meeting-vote-prompt"
        onFocus={() => {
          focusInside.current = true;
        }}
        onBlur={onBlur}
        className={cn(
          "dark w-[26rem] max-w-full rounded-2xl bg-popover p-4 text-left text-popover-foreground shadow-floating ring-1 ring-border",
          "[@media(max-height:500px)]:p-3",
          "animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand-subtle-foreground"
          >
            <Vote className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-overline text-muted-foreground">
              {t("meetings.governance.votePromptTitle")}
            </h2>
            <p className="mt-0.5 text-label font-medium text-pretty text-foreground">{motion.title}</p>
          </div>
        </div>

        {recorded ? (
          <p
            ref={recordedRef}
            tabIndex={-1}
            className="mt-3 flex items-center gap-2 text-label font-medium text-success outline-none"
          >
            <CircleCheck aria-hidden className="size-4 shrink-0" />
            {t("meetings.governance.voteRecorded")}
          </p>
        ) : (
          <>
            <div className="mt-3">
              <MeetingMotionBallot meetingId={meetingId} motion={motion} compact onCast={markRecorded} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t border-border pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={onOpenTab}>
                {t("meetings.governance.votePromptOpenTab")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
                {t("meetings.governance.votePromptHide")}
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
