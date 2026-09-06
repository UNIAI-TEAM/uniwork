"use client";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateMeeting } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { TimeInput } from "@uniwork/ui/components/ui/time-input";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { DateField } from "../common/date-field";
import { combineLocalIso, MEETING_TIMEZONES, splitIsoLocal } from "./meeting-datetime";

function meetingDraft(meeting: Meeting) {
  const initial = splitIsoLocal(meeting.starts_at);
  const initialEnd = splitIsoLocal(meeting.ends_at);
  return {
    title: meeting.title,
    description: meeting.description,
    date: initial.date,
    start: initial.time,
    end: initialEnd.time,
    timezone: meeting.timezone || "Asia/Ho_Chi_Minh",
    allowJoin: meeting.allow_join_request !== false,
  };
}

export function MeetingEditDialog({
  workspaceId,
  meeting,
  trigger,
}: {
  workspaceId: string;
  meeting: Meeting;
  trigger?: ReactElement;
}) {
  const { t } = useTranslation();
  const update = useUpdateMeeting(workspaceId, meeting.id);
  const inProgress = meeting.status === "IN_PROGRESS";
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(meeting.title);
  const [description, setDescription] = useState(meeting.description);
  const [date, setDate] = useState(() => splitIsoLocal(meeting.starts_at).date);
  const [start, setStart] = useState(() => splitIsoLocal(meeting.starts_at).time);
  const [end, setEnd] = useState(() => splitIsoLocal(meeting.ends_at).time);
  const [timezone, setTimezone] = useState(meeting.timezone || "Asia/Ho_Chi_Minh");
  const [allowJoin, setAllowJoin] = useState(meeting.allow_join_request !== false);

  useEffect(() => {
    if (!open) return;
    const draft = meetingDraft(meeting);
    setTitle(draft.title);
    setDescription(draft.description);
    setDate(draft.date);
    setStart(draft.start);
    setEnd(draft.end);
    setTimezone(draft.timezone);
    setAllowJoin(draft.allowJoin);
  }, [open, meeting]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? <Button size="sm" variant="outline">{t("meetings.edit")}</Button>} />
      <DialogContent className="max-h-[min(90dvh,44rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("meetings.edit")}</DialogTitle>
          <DialogDescription>{t("meetings.editDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              {
                title,
                description,
                timezone,
                allow_join_request: allowJoin,
                ...(inProgress ? {} : { starts_at: combineLocalIso(date, start), ends_at: combineLocalIso(date, end) }),
              },
              {
                onSuccess: () => {
                  setOpen(false);
                  toast.success(t("meetings.saveChanges"));
                },
                onError: (err) => toastApiError(err, t("common.error")),
              },
            );
          }}
        >
          <div className="space-y-3">
            <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {t("meetings.editSectionDetails")}
            </h3>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="edit-title">{t("meetings.meetingTitle")}</FieldLabel>
                <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-desc">{t("meetings.description")}</FieldLabel>
                <Textarea id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </Field>
            </FieldGroup>
          </div>

          {inProgress ? (
            <p className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-label text-muted-foreground">
              {t("meetings.editScheduleLocked")}
            </p>
          ) : (
            <div className="space-y-3">
              <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {t("meetings.editSectionSchedule")}
              </h3>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="edit-date">{t("meetings.date")}</FieldLabel>
                  <DateField id="edit-date" value={date} onChange={setDate} />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>{t("meetings.startsAt")}</FieldLabel>
                    <TimeInput value={start} onChange={setStart} hourLabel={t("meetings.startsAt")} minuteLabel={t("meetings.startsAt")} />
                  </Field>
                  <Field>
                    <FieldLabel>{t("meetings.endsAt")}</FieldLabel>
                    <TimeInput value={end} onChange={setEnd} hourLabel={t("meetings.endsAt")} minuteLabel={t("meetings.endsAt")} />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>{t("meetings.timezone")}</FieldLabel>
                  <Select
                    value={timezone}
                    onValueChange={(v) => v && setTimezone(v)}
                    items={MEETING_TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                  />
                </Field>
              </FieldGroup>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {t("meetings.editSectionAccess")}
            </h3>
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3">
              <span className="min-w-0 text-pretty text-body text-foreground">{t("meetings.allowJoinRequest")}</span>
              <Switch className="shrink-0" checked={allowJoin} onCheckedChange={setAllowJoin} />
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={update.isPending || !date}>
              {t("meetings.saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
