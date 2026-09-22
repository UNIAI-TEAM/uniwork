"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { meetingLocale } from "./meeting-datetime";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";

export function MeetingRoomFilesTab({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const { data: recordings, isLoading } = useRecordings(meetingId);
  const shared = (recordings ?? []).filter((r) => r.file_url);
  const [playbackId, setPlaybackId] = useState<string | null>(null);

  if (isLoading) {
    return <p className="text-label text-muted-foreground">{t("common.loading")}</p>;
  }

  if (shared.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-hover px-4 py-8 text-center">
        <p className="text-label text-muted-foreground">{t("meetings.filesEmpty")}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {shared.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface-hover px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="text-caption tabular-nums text-muted-foreground">
              {r.started_at
                ? new Date(r.started_at).toLocaleString(meetingLocale(i18n.language), {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : null}
            </span>
            <Button type="button" size="sm" variant="secondary" onClick={() => setPlaybackId(r.id)}>
              {t("meetings.recording_play")}
            </Button>
          </li>
        ))}
      </ul>
      {playbackId ? (
        <MeetingRecordingDialog
          open
          onOpenChange={(open) => {
            if (!open) setPlaybackId(null);
          }}
          meetingId={meetingId}
          recordingId={playbackId}
        />
      ) : null}
    </>
  );
}
