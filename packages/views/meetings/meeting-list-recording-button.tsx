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
}: {
  meetingId: string;
  enabled: boolean;
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
        // Icon-only on a phone, labelled from sm; the text stays for assistive tech either way.
        className="max-sm:w-7 max-sm:px-0 pointer-coarse:h-11 pointer-coarse:max-sm:w-11"
        onClick={() => setOpen(true)}
      >
        <Play aria-hidden />
        <span className="max-sm:sr-only">{t("meetings.recording_rewatch")}</span>
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
