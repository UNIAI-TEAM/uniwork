"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";

export function MeetingListRecordingButton({
  meetingId,
  enabled,
  compact = false,
}: {
  meetingId: string;
  enabled: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { data: recordings } = useRecordings(meetingId, enabled);
  const [open, setOpen] = useState(false);
  const playable = (recordings ?? []).find((r) => r.file_url);

  if (!enabled || !playable) return null;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={t("meetings.recording_rewatch")}
        className={compact ? "size-11 px-0 sm:h-8 sm:w-auto sm:px-2.5" : "h-8 px-2.5"}
        onClick={() => setOpen(true)}
      >
        <Play aria-hidden className={compact ? "size-4 sm:size-3.5" : "size-3.5"} />
        <span className={compact ? "hidden sm:inline" : undefined}>{t("meetings.recording_rewatch")}</span>
      </Button>
      <MeetingRecordingDialog
        open={open}
        onOpenChange={setOpen}
        meetingId={meetingId}
        recordingId={playable.id}
      />
    </>
  );
}
