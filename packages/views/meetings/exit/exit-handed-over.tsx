"use client";

import type { ReactNode } from "react";
import { ArrowRight, Crown, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { MeetingPersonAvatar } from "../meeting-person";
import { BackToMeetingButton, ExitActions, ExitBottom, ExitStory, RejoinButton } from "./exit-left";
import { ExitHeading } from "./exit-shell";

/** Board C: the host handed the room to someone and left. */
export function ExitHandedOver({
  toName,
  meetingTitle,
  presence,
  rating,
  onRejoin,
  onBackToMeeting,
}: {
  toName: string;
  meetingTitle?: string;
  presence: ReactNode;
  rating: ReactNode;
  onRejoin: () => void;
  onBackToMeeting: () => void;
}) {
  const { t } = useTranslation();
  const phone = useIsMobile();
  const myName = useAuthStore((s) => s.user?.display_name ?? "");
  const story = (
    <>
      <div role="img" aria-label={t("meetings.exit.handedOver.arrow", { name: toName })} className="flex items-center gap-4">
        <span aria-hidden className="size-14 opacity-80">
          <MeetingPersonAvatar name={myName} size="stage" />
        </span>
        <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-brand-subtle text-brand-subtle-foreground">
          <ArrowRight className="size-4" />
        </span>
        <span aria-hidden className="relative size-18 rounded-full ring-[3px] ring-primary ring-offset-4 ring-offset-background">
          <MeetingPersonAvatar name={toName} size="stage" />
          <span className="absolute -right-1.5 -bottom-1 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground ring-[3px] ring-background">
            <Crown className="size-3.5" />
          </span>
        </span>
      </div>
      <ExitHeading title={t("meetings.exit.handedOver.title", { name: toName })}>
        <p className="text-body-lg text-muted-foreground">
          {t("meetings.exit.handedOver.sub")}
          {meetingTitle ? ` · ${meetingTitle}` : ""}
        </p>
      </ExitHeading>
      {presence}
    </>
  );
  const asParticipant = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover px-2.5 py-1 text-caption text-muted-foreground">
      <UserRound aria-hidden className="size-3" />
      {t("meetings.exit.handedOver.asParticipant")}
    </span>
  );
  const actions = (
    <ExitActions primary={<RejoinButton onClick={onRejoin} />} secondary={<BackToMeetingButton onClick={onBackToMeeting} />} />
  );
  if (phone) {
    return (
      <>
        <ExitStory>
          {story}
          {asParticipant}
        </ExitStory>
        <ExitBottom>
          {actions}
          {rating}
        </ExitBottom>
      </>
    );
  }
  return (
    <>
      {story}
      <div className="flex w-full flex-col items-center gap-3">
        {actions}
        {asParticipant}
      </div>
      <div aria-hidden className="h-px w-full bg-border" />
      {rating}
    </>
  );
}
