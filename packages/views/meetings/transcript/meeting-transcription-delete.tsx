"use client";
import { useState } from "react";
import { FileHeadphone, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDeleteMeetingTranscription } from "@uniwork/core/meetings/transcript";
import type { MeetingTranscription } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../../common/form-dialog";
import { meetingLocale } from "../meeting-datetime";
import { formatMeetingMoment } from "../meeting-detail-format";

/**
 * Deletes one uploaded transcription that is done or failed, with its lines
 * and its recording, after a confirm (UNI-1995 #5).
 */
export function TranscriptionDeleteButton({
  meetingId,
  transcription,
  label,
}: {
  meetingId: string;
  transcription: MeetingTranscription;
  label: string;
}) {
  const { t } = useTranslation();
  const remove = useDeleteMeetingTranscription(meetingId);
  const [ask, setAsk] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="text-muted-foreground"
        aria-label={label}
        onClick={() => setAsk(true)}
      >
        <Trash2 aria-hidden />
      </Button>
      {ask ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setAsk(false);
          }}
          title={t("meetings.transcription.deleteTitle")}
          description={t("meetings.transcription.deleteDescription", { file: transcription.filename || "—" })}
          confirmLabel={t("meetings.transcriptDeleteConfirm")}
          pending={remove.isPending}
          icon={Trash2}
          onConfirm={() => {
            if (remove.isPending) return;
            remove.mutateAsync(transcription.id).then(
              () => setAsk(false),
              () => toast.error(t("meetings.transcriptChangeFailed")),
            );
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The finished uploads before the latest one (a meeting uploaded in parts),
 * each deletable on its own: the latest is not the only recording a clerk
 * may need to remove.
 */
export function EarlierTranscriptions({ meetingId, transcriptions }: { meetingId: string; transcriptions: MeetingTranscription[] }) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const finished = transcriptions.filter((x) => x.status === "COMPLETE" || x.status === "FAILED");
  if (finished.length === 0) return null;
  return (
    <ul aria-label={t("meetings.transcription.earlier")} className="space-y-1">
      {finished.map((x) => {
        const file = x.filename || "—";
        const time = formatMeetingMoment(x.completed_at, locale);
        return (
          <li key={x.id} className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <FileHeadphone aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 wrap-anywhere">
              {t(`meetings.transcription.status.${x.status}`, { file })}
              {time ? ` · ${t("meetings.transcription.at", { time })}` : ""}
            </span>
            <TranscriptionDeleteButton
              meetingId={meetingId}
              transcription={x}
              label={t("meetings.transcription.deleteNamed", { file })}
            />
          </li>
        );
      })}
    </ul>
  );
}
