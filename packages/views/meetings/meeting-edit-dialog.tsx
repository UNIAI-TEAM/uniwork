"use client";
import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateMeeting } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { TimeInput } from "@uniwork/ui/components/ui/time-input";
import { toast } from "sonner";
import { combineLocalIso, MEETING_TIMEZONES, splitIsoLocal } from "./meeting-datetime";

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
  const initial = splitIsoLocal(meeting.starts_at);
  const initialEnd = splitIsoLocal(meeting.ends_at);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(meeting.title);
  const [description, setDescription] = useState(meeting.description);
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.time);
  const [end, setEnd] = useState(initialEnd.time);
  const [timezone, setTimezone] = useState(meeting.timezone || "Asia/Ho_Chi_Minh");
  const [allowJoin, setAllowJoin] = useState(meeting.allow_join_request !== false);
  const inProgress = meeting.status === "IN_PROGRESS";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? <Button size="sm" variant="outline">{t("meetings.edit")}</Button>} />
      <DialogContent className="max-h-[min(90dvh,40rem)] overflow-y-auto sm:max-w-lg">
        <DialogTitle>{t("meetings.edit")}</DialogTitle>
        <form
          className="space-y-4"
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
                onError: () => toast.error(t("common.error")),
              },
            );
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-title">{t("meetings.meetingTitle")}</FieldLabel>
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-desc">{t("meetings.description")}</FieldLabel>
              <Textarea id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </Field>
            {inProgress ? null : (
              <>
                <Field>
                  <FieldLabel htmlFor="edit-date">{t("meetings.date")}</FieldLabel>
                  <Input id="edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
              </>
            )}
            <Field>
              <FieldLabel htmlFor="edit-meeting-timezone">{t("meetings.timezone")}</FieldLabel>
              <Select
                id="edit-meeting-timezone"
                value={timezone}
                onValueChange={(v) => v && setTimezone(v)}
                items={MEETING_TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
              />
            </Field>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span className="min-w-0 text-pretty text-body text-foreground">{t("meetings.allowJoinRequest")}</span>
              <Switch className="shrink-0" checked={allowJoin} onCheckedChange={setAllowJoin} />
            </label>
          </FieldGroup>
          <Button type="submit" disabled={update.isPending}>
            {t("meetings.saveChanges")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
