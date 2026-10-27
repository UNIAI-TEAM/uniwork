"use client";
import { useState } from "react";
import { UserPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingSpeakerLabelsDialog } from "../meeting-speaker-labels-dialog";
import { ScheduleFollowUpButton } from "../schedule-follow-up-button";
import { useDetail } from "./detail-context";
import type { StripJob } from "./next-step-jobs";
import { usePhoneBar } from "./phone-frame";
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
