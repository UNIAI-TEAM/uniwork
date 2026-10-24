"use client";
import { useTranslation } from "react-i18next";
import { useOlderTranscript, useTranscript } from "@uniwork/core/meetings";
import { useDetail } from "../detail-context";
import { Byline } from "../ui/section";
import { LiveTicker } from "./live-ticker";
import { NotesFeed } from "./notes-feed";
import { ScribeSign } from "../../scribe-sign";

/**
 * The live page's "Ghi chú chung" tab: the "Đang nói" ticker, the shared
 * notes with their composer, and one AI status line. AI produces nothing in
 * the column until the meeting ends (brief principle 6).
 */
export function LiveNotesTab() {
  const { t } = useTranslation();
  const { meeting, aiReadable } = useDetail();
  const { data: lines } = useTranscript(meeting.id, aiReadable);
  // The window holds the newest page plus what arrived since: a count is the meeting's only once nothing older is left.
  const { hasOlder } = useOlderTranscript(meeting.id, aiReadable);
  return (
    <section id="ghi-chu" aria-label={t("meetings.detail.notes.liveLabel")} className="mt-4 [[data-panel=roll]_&]:mt-1">
      <LiveTicker line={lines?.at(-1)} />
      <NotesFeed variant="live" />
      {meeting.scribe_enabled && aiReadable ? (
        <Byline className="mt-3 [[data-panel=roll]_&]:mt-2 @max-[37.5rem]/meeting:text-balance">
          <ScribeSign state="live" />
          <span>
            {hasOlder
              ? t("meetings.detail.live.aiListeningUncounted")
              : t("meetings.detail.live.aiListening", { count: lines?.length ?? 0 })}
          </span>
        </Byline>
      ) : null}
    </section>
  );
}
