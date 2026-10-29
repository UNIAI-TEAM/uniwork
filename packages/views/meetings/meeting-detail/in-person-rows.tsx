"use client";
import { useState } from "react";
import { AudioLines, CloudUpload, Mic, UserPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUnsentRecordings } from "@uniwork/core/meetings/recorder";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../../common/form-dialog";
import { toastApiError } from "../../toast-api-error";
import { useWorkspace } from "../../layout/workspace-context";
import { formatOffset } from "../meeting-recording-offset";
import { MeetingSpeakerLabelsDialog } from "../meeting-speaker-labels-dialog";
import { ScheduleFollowUpButton } from "../schedule-follow-up-button";
import { useDetail } from "./detail-context";
import { DetailMenu } from "./detail-header";
import { clock } from "./format";
import type { StripJob } from "./next-step-jobs";
import { PhonePrimary, usePhoneBar } from "./phone-frame";
import type { StripHandlers } from "./strip-rows";
import { kitButton } from "./ui/kit-buttons";
import { StripRow } from "./ui/strip";

/** In person, after the recording was sent (board p07): how long it is and when the summary comes. */
export function TranscribingRow({ job, h }: { job: Extract<StripJob, { kind: "transcribing" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const { meeting, workspaceId, participants, canHost } = useDetail();
  const phone = usePhoneBar();
  return (
    <StripRow
      title={<strong>{t("meetings.record.transcribingTitle", { minutes: job.minutes })}</strong>}
      caption={t("meetings.record.transcribingEta", { count: job.etaMinutes })}
      actions={
        canHost && !phone ? (
          <ScheduleFollowUpButton workspaceId={workspaceId} meeting={meeting} participants={participants} onCreated={h.onFollowUpCreated} />
        ) : undefined
      }
    />
  );
}

/** Gán người nói in the close-out row (board p09): the speakers dialog the transcript's ⋯ opens too. */
export function NameSpeakersButton({ primary }: { primary: boolean }) {
  const { t } = useTranslation();
  const { meeting, workspaceId } = useDetail();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="lg"
        variant={primary ? "brand" : "outline"}
        className={cn(kitButton.base, primary ? "" : kitButton.outline)}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <UserPen aria-hidden />
        {t("meetings.scribe.speakersButton")}
      </Button>
      {open ? <MeetingSpeakerLabelsDialog meetingId={meeting.id} workspaceId={workspaceId} open onOpenChange={setOpen} /> : null}
    </>
  );
}

/** A recording this account left on this device (board p11): continue it, send it, or delete it. */
export function UnsentRow({ job, h }: { job: Extract<StripJob, { kind: "unsent" }>; h: StripHandlers }) {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const { user } = useWorkspace();
  const { discard } = useUnsentRecordings(user.id, meeting.id);
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteLocal = t("meetings.record.deleteLocal");
  return (
    <StripRow
      actions={
        <>
          <DetailMenu items={[{ key: "deleteLocal", label: deleteLocal, destructive: true, onSelect: () => setAsking(true) }]} />
          {job.canContinue && h.onRecord ? (
            <Button type="button" size="lg" variant="outline" className={cn(kitButton.base, kitButton.outline)} onClick={() => h.onRecord?.()}>
              <Mic aria-hidden />
              {t("meetings.record.continue")}
            </Button>
          ) : null}
          {job.canSend && h.onRecord ? (
            <PhonePrimary>
              <Button type="button" size="lg" variant="brand" className={kitButton.base} onClick={() => h.onRecord?.({ send: true })}>
                <CloudUpload aria-hidden />
                {t("meetings.record.endAndSend")}
              </Button>
            </PhonePrimary>
          ) : null}
          <ConfirmDialog
            open={asking}
            onOpenChange={setAsking}
            title={t("meetings.record.deleteLocalConfirm")}
            confirmLabel={t("common.delete")}
            pending={deleting}
            onConfirm={() => {
              if (deleting) return;
              setDeleting(true);
              // A failed delete keeps the question open, so the person can try again.
              discard().then(
                () => {
                  setDeleting(false);
                  setAsking(false);
                },
                (err: unknown) => {
                  setDeleting(false);
                  toastApiError(err, t("common.error"));
                },
              );
            }}
          />
        </>
      }
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex size-5.5 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning">
          <AudioLines aria-hidden className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-body font-semibold">{t("meetings.record.unsentTitle", { duration: formatOffset(Math.round(job.seconds)) })}</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {t("meetings.record.unsentSub", { time: clock(new Date(job.savedAt).toISOString()) })}
          </p>
        </div>
      </div>
    </StripRow>
  );
}
