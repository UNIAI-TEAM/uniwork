"use client";
import { useId, useRef, useState } from "react";
import { CalendarCheck, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api";
import { useMeetingCapabilities } from "@uniwork/core/meetings";
import { useRecordMeetingHeld } from "@uniwork/core/meetings/transcriptions";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { apiErrorCopy } from "../api-error-copy";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { Notice } from "../common/notice";
import { sameUtcOffset, scheduleWindowIso, splitIsoLocal } from "./meeting-datetime";
import { meetingTimeZoneLabel } from "./meeting-detail-format";
import { browserTimeZone, MeetingScheduleFields, scheduleValid } from "./meeting-schedule-fields";
import { transcriptFocusTarget } from "./meeting-detail/transcript/transcript-tab";
import { useNow } from "./use-now";

/**
 * "Record as held" (parent spec D10, §9.2): a meeting held in person without
 * opening a room is ended at the times the host enters, defaulting to the
 * schedule. Host or admin only; the caller decides who sees the button.
 */
export function MeetingRecordHeldButton({
  workspaceId,
  meeting,
  size = "sm",
  className,
}: {
  workspaceId: string;
  meeting: Meeting;
  size?: "sm" | "lg";
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size={size} variant="outline" className={className} onClick={() => setOpen(true)}>
        <CalendarCheck aria-hidden />
        {t("meetings.held.button")}
      </Button>
      {open ? <MeetingRecordHeldDialog workspaceId={workspaceId} meeting={meeting} onOpenChange={setOpen} /> : null}
    </>
  );
}

function MeetingRecordHeldDialog({
  workspaceId,
  meeting,
  onOpenChange,
}: {
  workspaceId: string;
  meeting: Meeting;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const idPrefix = useId();
  const nowMs = useNow();
  const reasonId = useId();
  const zone = meeting.timezone?.trim() || undefined;
  // Times are typed in the meeting's zone; say which one when it is not the viewer's.
  const zoneLabel = zone && !sameUtcOffset(zone, browserTimeZone(), nowMs) ? meetingTimeZoneLabel(zone, i18n.language) : "";
  const caps = useMeetingCapabilities(workspaceId);
  const [date, setDate] = useState(() => splitIsoLocal(meeting.starts_at, zone).date);
  const [start, setStart] = useState(() => splitIsoLocal(meeting.starts_at, zone).time);
  // Opened while the window still runs, the scheduled end is in the future
  // and would be refused: the end starts at now, whichever comes first.
  const [end, setEnd] = useState(
    () => splitIsoLocal(new Date(Math.min(Date.parse(meeting.ends_at), Date.now())).toISOString(), zone).time,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const record = useRecordMeetingHeld(workspaceId, meeting.id);
  const span = scheduleWindowIso(date, start, end, zone);
  const endInFuture = Date.parse(span.ends_at) > nowMs;
  const ready = Boolean(date) && scheduleValid(start, end) && !endInFuture;
  // The opener unmounts once the meeting is ended: a success lands focus on the transcript card.
  const succeeded = useRef(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || record.isPending) return;
    setFailure(null);
    record.mutate(
      { started_at: span.starts_at, ended_at: span.ends_at },
      {
        onSuccess: () => {
          succeeded.current = true;
          toast.success(t("meetings.held.done"));
          onOpenChange(false);
        },
        onError: (err) => {
          const detail =
            errorCode(err) === "invalid_held_times" ? t("meetings.held.invalidTimes") : apiErrorCopy(err);
          setFailure(detail ? `${t("meetings.held.failed")} ${detail}` : t("meetings.held.failed"));
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (record.isPending ? undefined : onOpenChange(next))}>
      <FormDialogContent
        showCloseButton={!record.isPending}
        finalFocus={() => (succeeded.current ? transcriptFocusTarget() : true)}
      >
        <form onSubmit={submit}>
          <FormDialogHeader
            title={t("meetings.held.title")}
            description={t(caps.data?.transcription ? "meetings.held.descriptionUpload" : "meetings.held.description")}
          />
          <FormDialogBody>
            <MeetingScheduleFields
              idPrefix={idPrefix}
              date={date}
              start={start}
              end={end}
              onDate={setDate}
              onStart={setStart}
              onEnd={setEnd}
              minDate={null}
              timeZone={zone}
              checkPast={false}
            />
            {zoneLabel ? (
              <p className="text-caption text-muted-foreground">{t("meetings.held.zoneHint", { zone: zoneLabel })}</p>
            ) : null}
            {endInFuture ? (
              <p id={reasonId} role="alert" className="text-caption text-destructive">
                {t("meetings.held.endInFuture")}
              </p>
            ) : null}
            {failure ? (
              <Notice tone="destructive" icon={CircleAlert} layout="inline" live="assertive">
                {failure}
              </Notice>
            ) : null}
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => onOpenChange(false)}
            submitLabel={t("meetings.held.submit")}
            submittingLabel={t("meetings.held.submitting")}
            submitType="submit"
            submitting={record.isPending}
            submitDisabled={!ready}
            reasonId={endInFuture ? reasonId : undefined}
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
