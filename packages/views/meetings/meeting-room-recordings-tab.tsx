"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { formatMessageTime } from "../chat/chat-message-time";
import { FeedKindMark } from "./meeting-copilot/feed-filter-chips";
import { PlayRecordingButton } from "./meeting-copilot/feed-list";
import { meetingLocale } from "./meeting-datetime";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";

/**
 * A guest's recordings, in the UNI feed's recording row: guests have no UNI
 * tab, so the room shows them here, and only once one can be played (COMPLETE,
 * the one playable state on both storage paths, UNI-746).
 */
export function MeetingRoomRecordingsTab({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const { data } = useRecordings(meetingId);
  const [playing, setPlaying] = useState<string | null>(null);
  const kind = t("meetings.panel.kind.recording");
  return (
    <>
      <ol aria-label={t("meetings.recordingsTab")} className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {(data ?? [])
          .filter((r) => r.status === "COMPLETE")
          .map((r) => {
            const ms = Date.parse(r.ended_at ?? r.started_at ?? "");
            const time = Number.isFinite(ms) ? formatMessageTime(ms, locale) : null;
            return (
              <li key={r.id} className="flex items-center gap-2.5 px-0.5 py-2.5">
                <FeedKindMark kind="recording" size="row" label={kind} />
                <div className="min-w-0 flex-1">
                  <PlayRecordingButton time={time} onPlay={() => setPlaying(r.id)} />
                </div>
                <span className="shrink-0 text-caption text-faint-foreground tabular-nums">{time}</span>
              </li>
            );
          })}
      </ol>
      {playing ? (
        <MeetingRecordingDialog
          open
          onOpenChange={(next) => {
            if (!next) setPlaying(null);
          }}
          meetingId={meetingId}
          recordingId={playing}
        />
      ) : null}
    </>
  );
}
