"use client";
import { useId, useState } from "react";
import { CalendarCheck, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingCapabilities } from "@uniwork/core/meetings";
import { useRecordMeetingHeld } from "@uniwork/core/meetings/transcriptions";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { apiErrorCopy } from "../api-error-copy";
import { Notice } from "../common/notice";
import { scheduleWindowIso, splitIsoLocal } from "./meeting-datetime";
import { MeetingScheduleFields, scheduleValid } from "./meeting-schedule-fields";
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
  const { t } = useTranslation();
  const idPrefix = useId();
  const nowMs = useNow();
  const reasonId = useId();
  const zone = meeting.timezone?.trim() || undefined;
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
  const blocked = !ready || record.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    setFailure(null);
    record.mutate(
      { started_at: span.starts_at, ended_at: span.ends_at },
      {
        onSuccess: () => {
          toast.success(t("meetings.held.done"));
          onOpenChange(false);
        },
        onError: (err) => {
          const detail = apiErrorCopy(err);
          setFailure(detail ? `${t("meetings.held.failed")} ${detail}` : t("meetings.held.failed"));
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("meetings.held.title")}</DialogTitle>
            <DialogDescription>
              {t(caps.data?.transcription ? "meetings.held.descriptionUpload" : "meetings.held.description")}
            </DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              aria-disabled={blocked || undefined}
              aria-busy={record.isPending || undefined}
              aria-describedby={endInFuture ? reasonId : undefined}
            >
              {record.isPending ? <Spinner /> : null}
              {t("meetings.held.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
