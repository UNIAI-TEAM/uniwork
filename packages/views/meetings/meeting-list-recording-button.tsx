"use client";

import { LoaderCircle, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { toastApiError } from "../toast-api-error";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";

/**
 * Rendered only for a row the list payload flags `has_playable_recording`, so
 * a page of ended meetings costs no requests; the recordings are fetched when
 * the viewer asks to watch, and the dialog opens once the playable one is known.
 */
export function MeetingListRecordingButton({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const [wanted, setWanted] = useState(false);
  const { data: recordings, isFetching, isError, error, errorUpdatedAt, refetch } = useRecordings(
    meetingId,
    wanted,
  );
  // A click that fails to load must say so; keyed on errorUpdatedAt so each
  // failed retry speaks again while isError stays true across them.
  useEffect(() => {
    if (wanted && isError) toastApiError(error, t("meetings.recordingsLoadFailed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per failure, not per render
  }, [errorUpdatedAt]);
  const playable = recordings?.find((r) => r.file_url);
  // The flag said yes but the list came back without a file (deleted since): nothing to offer.
  if (recordings && !playable) return null;
  const loading = wanted && !playable && isFetching;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        // Icon-only on a phone, labelled from sm; the text stays for assistive tech either way.
        className="max-sm:w-7 max-sm:px-0"
        aria-busy={loading || undefined}
        onClick={() => {
          setWanted(true);
          // A failed fetch leaves `wanted` on; the next click is the retry.
          if (isError) void refetch();
        }}
      >
        {loading ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Play aria-hidden />}
        <span className="max-sm:sr-only">{t("meetings.recording_rewatch")}</span>
      </Button>
      {playable ? (
        <MeetingRecordingDialog
          open={wanted}
          onOpenChange={setWanted}
          meetingId={meetingId}
          recordingId={playable.id}
        />
      ) : null}
    </>
  );
}
