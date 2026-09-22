"use client";
import { useEffect, useId, useState, type ReactElement } from "react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdateMeeting } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toast } from "sonner";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { Notice } from "../common/notice";
import { toastApiError } from "../toast-api-error";
import { combineLocalIso, MEETING_TIMEZONES, splitIsoLocal } from "./meeting-datetime";
import {
  browserTimeZone,
  MeetingScheduleFields,
  scheduleValid,
} from "./meeting-schedule-fields";

function meetingDraft(meeting: Meeting) {
  const initial = splitIsoLocal(meeting.starts_at);
  const initialEnd = splitIsoLocal(meeting.ends_at);
  return {
    title: meeting.title,
    description: meeting.description,
    date: initial.date,
    start: initial.time,
    end: initialEnd.time,
    timezone: meeting.timezone || browserTimeZone(),
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
  const id = useId();
  const update = useUpdateMeeting(workspaceId, meeting.id);
  const inProgress = meeting.status === "IN_PROGRESS";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => meetingDraft(meeting));
  const { title, description, date, start, end, timezone, allowJoin } = draft;
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (open) setDraft(meetingDraft(meeting));
  }, [open, meeting]);

  const titleMissing = !title.trim();
  const scheduleReady = inProgress || (Boolean(date) && scheduleValid(start, end));
  const ready = !titleMissing && scheduleReady;
  // The record may carry a zone the short list does not; keep it pickable.
  const zones: string[] = MEETING_TIMEZONES.includes(timezone as (typeof MEETING_TIMEZONES)[number])
    ? [...MEETING_TIMEZONES]
    : [timezone, ...MEETING_TIMEZONES];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? <Button size="sm" variant="outline">{t("meetings.edit")}</Button>} />
      <FormDialogContent size="lg">
        <FormDialogHeader title={t("meetings.edit")} description={t("meetings.editDescription")} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
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
                  toast.success(t("meetings.changesSaved"));
                },
                onError: (err) => toastApiError(err, t("common.error")),
              },
            );
          }}
        >
          <FormDialogBody className="space-y-5">
            <section className="space-y-3" aria-labelledby={`${id}-details`}>
              <h3 id={`${id}-details`} className="text-overline text-muted-foreground">
                {t("meetings.editSectionDetails")}
              </h3>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor={`${id}-title`}>{t("meetings.meetingTitle")}</FieldLabel>
                  <Input
                    id={`${id}-title`}
                    value={title}
                    onChange={(e) => set("title")(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-desc`}>{t("meetings.description")}</FieldLabel>
                  <Textarea
                    id={`${id}-desc`}
                    value={description}
                    onChange={(e) => set("description")(e.target.value)}
                    rows={3}
                  />
                </Field>
              </FieldGroup>
            </section>

            {inProgress ? (
              <Notice tone="muted" icon={Lock} layout="inline" live="off">
                {t("meetings.editScheduleLocked")}
              </Notice>
            ) : (
              <section className="space-y-3" aria-labelledby={`${id}-schedule`}>
                <h3 id={`${id}-schedule`} className="text-overline text-muted-foreground">
                  {t("meetings.editSectionSchedule")}
                </h3>
                <FieldGroup className="gap-4">
                  <MeetingScheduleFields
                    idPrefix={id}
                    date={date}
                    start={start}
                    end={end}
                    onDate={set("date")}
                    onStart={set("start")}
                    onEnd={set("end")}
                    minDate={null}
                  />
                  <Field aria-labelledby={`${id}-tz-label`}>
                    <FieldLabel id={`${id}-tz-label`}>{t("meetings.timezone")}</FieldLabel>
                    <Select
                      value={timezone}
                      onValueChange={(v) => v && set("timezone")(v)}
                      items={zones.map((tz) => ({ value: tz, label: tz }))}
                    />
                  </Field>
                </FieldGroup>
              </section>
            )}

            <section className="space-y-3" aria-labelledby={`${id}-access`}>
              <h3 id={`${id}-access`} className="text-overline text-muted-foreground">
                {t("meetings.editSectionAccess")}
              </h3>
              <div className="flex min-h-11 items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <FieldLabel id={`${id}-allow-join-label`} htmlFor={`${id}-allow-join`}>
                    {t("meetings.allowJoinRequest")}
                  </FieldLabel>
                  <FieldDescription id={`${id}-allow-join-hint`}>
                    {t("meetings.allowJoinRequestHint")}
                  </FieldDescription>
                </div>
                <Switch
                  id={`${id}-allow-join`}
                  aria-labelledby={`${id}-allow-join-label`}
                  aria-describedby={`${id}-allow-join-hint`}
                  className="mt-0.5 shrink-0"
                  checked={allowJoin}
                  onCheckedChange={set("allowJoin")}
                />
              </div>
              <FieldDescription>{t("meetings.externalGuestLinkWhere")}</FieldDescription>
            </section>
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => setOpen(false)}
            submitType="submit"
            submitLabel={t("meetings.saveChanges")}
            submittingLabel={t("meetings.saving")}
            submitting={update.isPending}
            submitDisabled={!ready}
            leading={titleMissing ? t("meetings.titleRequired") : undefined}
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
