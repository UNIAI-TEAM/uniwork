"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Notice } from "../common/notice";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";

const ackKey = (meetingKey: string) => `uw.meeting.scribeNotice.${meetingKey}`;

/** The notice was acknowledged for this meeting in this tab; a blocked storage reads as not yet. */
function acknowledged(meetingKey: string): boolean {
  try {
    return sessionStorage.getItem(ackKey(meetingKey)) === "1";
  } catch {
    return false;
  }
}

function acknowledge(meetingKey: string) {
  try {
    sessionStorage.setItem(ackKey(meetingKey), "1");
  } catch {
    // Storage blocked: the notice comes back on the next screen, which is the safe side.
  }
}

/**
 * Consent notice before anyone is transcribed (UNI-1995 access, #2): shown in
 * the prejoin and the lobby, to members and guests alike, while the meeting
 * has the scribe. It says that Thư ký UNI is an AI, who keeps the transcript
 * and who reads it (where the audio is processed is said only in the
 * organization's settings); once acknowledged it stays away for
 * the meeting in this tab, so prejoin and lobby do not ask twice.
 *
 * `chip` is the member prejoin's form (UNI-2285 D): one violet line, with the
 * same paragraph behind "?" (hover, tap or keyboard). Guests keep `full`.
 */
export function MeetingScribeNotice({
  meetingKey,
  scribeOn,
  variant = "full",
}: {
  meetingKey: string;
  scribeOn: boolean;
  variant?: "chip" | "full";
}) {
  const { t } = useTranslation();
  const [done, setDone] = useState(() => acknowledged(meetingKey));
  if (!scribeOn) return null;
  if (variant === "chip") return <ScribeChip />;
  if (done) return null;
  return (
    <Notice
      tone="info"
      icon={ScribeMark}
      layout="inline"
      live="off"
      className="items-start text-left"
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            acknowledge(meetingKey);
            setDone(true);
          }}
        >
          {t("meetings.scribe.noticeAck")}
        </Button>
      }
    >
      <span data-testid="meeting-scribe-notice" className="block">
        <span className="block font-semibold">{t("meetings.scribe.noticeTitle")}</span>
        <span className="mt-0.5 block font-normal">{t("meetings.scribe.noticeBody")}</span>
      </span>
    </Notice>
  );
}

function ScribeChip() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="meeting-scribe-chip"
      className="flex items-center gap-2 rounded-control bg-tint-violet py-1.5 pr-1.5 pl-2 text-label font-semibold text-tint-violet-foreground"
    >
      <ScribeMark size={20} />
      <span className="min-w-0 truncate">{t("meetings.motion.prejoin.scribeChip")}</span>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={0}
          aria-label={t("meetings.scribe.helpTitle")}
          // A 44 hit area on touch drawn as an overlay, so the chip keeps its height.
          className="relative ml-auto grid size-5.5 shrink-0 cursor-help place-items-center rounded-full bg-tint-violet-foreground/10 text-caption font-bold pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']"
        >
          {"?"}
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={8} className="w-70 max-w-[calc(100vw-2rem)] gap-1 px-3.5 py-3">
          <p className="font-semibold text-foreground">{t("meetings.scribe.chipShort")}</p>
          <p className="text-label text-pretty text-foreground">{t("meetings.scribe.noticeBody")}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
