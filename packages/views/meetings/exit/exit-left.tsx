"use client";

import type { ReactNode } from "react";
import { LogOut, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { cn } from "@uniwork/ui/lib/utils";
import type { ExitMedia } from "./exit-model";
import { ExitHeading, ExitMark } from "./exit-shell";

/** The devices "Vào lại" brings back, as two chips: on reads in brand blue. */
export function ExitMediaChips({ media }: { media: ExitMedia }) {
  const { t } = useTranslation();
  const chip = (on: boolean, icon: ReactNode, label: string) => (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption [&_svg]:size-3",
        on ? "bg-brand-subtle text-brand-subtle-foreground" : "bg-surface-hover text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </span>
  );
  return (
    <div role="group" aria-label={t("meetings.exit.mediaGroup")} className="flex justify-center gap-2">
      {chip(media.audio, media.audio ? <Mic aria-hidden /> : <MicOff aria-hidden />, t(media.audio ? "meetings.exit.micOn" : "meetings.exit.micOff"))}
      {chip(media.video, media.video ? <Video aria-hidden /> : <VideoOff aria-hidden />, t(media.video ? "meetings.exit.camOn" : "meetings.exit.camOff"))}
    </div>
  );
}

/** "Vào lại" and "Về trang cuộc họp": side by side on a desktop, stacked full width on a phone. */
export function ExitActions({ primary, secondary }: { primary: ReactNode; secondary: ReactNode }) {
  const phone = useIsMobile();
  return (
    <div className={cn("flex w-full gap-3", phone ? "flex-col" : "flex-wrap justify-center [&>*]:max-w-64 [&>*]:flex-[1_1_12.5rem]")}>
      {primary}
      {secondary}
    </div>
  );
}

export function RejoinButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button type="button" size="lg" className="min-h-12 rounded-xl text-body-lg font-semibold" onClick={onClick}>
      <Video aria-hidden className="size-4" />
      {t("meetings.exit.rejoin")}
    </Button>
  );
}

export function BackToMeetingButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const { t } = useTranslation();
  return (
    <Button type="button" variant="outline" size="lg" className="min-h-12 rounded-xl text-body-lg" onClick={onClick}>
      {label ?? t("meetings.backToMeeting")}
    </Button>
  );
}

/** Board A: a participant left; the meeting goes on without them. */
export function ExitLeft({
  meetingTitle,
  media,
  presence,
  rating,
  onRejoin,
  onBackToMeeting,
}: {
  meetingTitle?: string;
  media: ExitMedia;
  presence: ReactNode;
  rating: ReactNode;
  onRejoin: () => void;
  onBackToMeeting: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ExitMark>
        <LogOut aria-hidden />
      </ExitMark>
      <ExitHeading title={t("meetings.exit.left.title")}>
        {meetingTitle ? <p className="text-body-lg text-muted-foreground">{meetingTitle}</p> : null}
      </ExitHeading>
      {presence}
      <div className="flex w-full flex-col items-center gap-3">
        <ExitActions
          primary={<RejoinButton onClick={onRejoin} />}
          secondary={<BackToMeetingButton onClick={onBackToMeeting} />}
        />
        <ExitMediaChips media={media} />
      </div>
      <div aria-hidden className="h-px w-full bg-border" />
      {rating}
    </>
  );
}
