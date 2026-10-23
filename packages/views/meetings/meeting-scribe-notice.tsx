"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";

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
 * has the AI scribe. It says who keeps the transcript, who reads it and that
 * the audio is processed outside Vietnam; once acknowledged it stays away for
 * the meeting in this tab, so prejoin and lobby do not ask twice.
 */
export function MeetingScribeNotice({ meetingKey, scribeOn }: { meetingKey: string; scribeOn: boolean }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(() => acknowledged(meetingKey));
  if (!scribeOn || done) return null;
  return (
    <Notice
      tone="info"
      icon={Sparkles}
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
