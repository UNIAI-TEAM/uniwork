"use client";
import { useId, useRef, useState, type ReactElement } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdateMeeting } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
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
import { MEETING_TIMEZONES, scheduleWindowIso, splitIsoLocal } from "./meeting-datetime";
import { meetingTimeZoneLabel } from "./meeting-detail-format";
import {
  browserTimeZone,
  focusScheduleProblem,
  MeetingScheduleFields,
  scheduleProblems,
  scheduleReady,
} from "./meeting-schedule-fields";
import { useNow } from "./use-now";

/** The form is typed in the meeting's own zone, so 09:00 Tokyo stays 09:00 whoever opens it. */
function meetingDraft(meeting: Meeting) {
  const timezone = meeting.timezone || browserTimeZone();
  const initial = splitIsoLocal(meeting.starts_at, timezone);
  const initialEnd = splitIsoLocal(meeting.ends_at, timezone);
  return {
    title: meeting.title,
    description: meeting.description,
    date: initial.date,
    start: initial.time,
    end: initialEnd.time,
    timezone,
    allowJoin: meeting.allow_join_request !== false,
  };
}

/** What changes when someone else saves: the server version, or the fields themselves. */
function meetingRevision(meeting: Meeting): string {
  if (meeting.version !== undefined) return String(meeting.version);
  return JSON.stringify([
    meeting.title,
    meeting.description,
    meeting.starts_at,
    meeting.ends_at,
    meeting.timezone,
    meeting.allow_join_request,
    meeting.status,
  ]);
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
  const { t, i18n } = useTranslation();
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const update = useUpdateMeeting(workspaceId, meeting.id);
  const nowMs = useNow();
  const inProgress = meeting.status === "IN_PROGRESS";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => meetingDraft(meeting));
  // What the form was seeded from. A realtime refetch while the dialog is
  // open must not wipe what the host is typing, so the draft is seeded only
  // when the dialog opens, and a newer server copy is offered, not forced.
  const [seed, setSeed] = useState(() => ({ draft: meetingDraft(meeting), revision: meetingRevision(meeting) }));
  const [submitted, setSubmitted] = useState(false);
  const { title, description, date, start, end, timezone, allowJoin } = draft;
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const reseed = () => {
    const next = meetingDraft(meeting);
    setDraft(next);
    setSeed({ draft: next, revision: meetingRevision(meeting) });
    setSubmitted(false);
  };
  const changeOpen = (next: boolean) => {
    if (next) reseed();
    setOpen(next);
  };
  const staleSeed = open && !update.isPending && seed.revision !== meetingRevision(meeting);

  const titleMissing = !title.trim();
  // Only a start the host moved is checked against the clock: a meeting that
  // already started (or was missed) keeps its start when only the title changes.
  const startTouched = date !== seed.draft.date || start !== seed.draft.start || timezone !== seed.draft.timezone;
  const problems = scheduleProblems({ date, start, end, timeZone: timezone, nowMs, checkPast: startTouched });
  const scheduleOk = inProgress || scheduleReady(date, problems);
  const showTitleError = titleMissing && submitted;
  // The record may carry a zone the short list does not; keep it pickable.
  const zones: string[] = MEETING_TIMEZONES.includes(timezone as (typeof MEETING_TIMEZONES)[number])
    ? [...MEETING_TIMEZONES]
    : [timezone, ...MEETING_TIMEZONES];

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger ?? <Button size="sm" variant="outline">{t("meetings.edit")}</Button>} />
      <FormDialogContent size="lg">
        <FormDialogHeader title={t("meetings.edit")} description={t("meetings.editDescription")} />
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (titleMissing) {
              titleRef.current?.focus();
              return;
            }
            if (!scheduleOk) {
              focusScheduleProblem(id, problems);
              return;
            }
            const slot = inProgress ? null : scheduleWindowIso(date, start, end, timezone);
            update.mutate(
              {
                title,
                description,
                timezone,
                allow_join_request: allowJoin,
                ...(slot ? { starts_at: slot.starts_at, ends_at: slot.ends_at } : {}),
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
            {staleSeed ? (
              <Notice
                tone="info"
                icon={RefreshCw}
                layout="inline"
                action={
                  <Button type="button" size="sm" variant="outline" onClick={reseed}>
                    {t("meetings.editReload")}
                  </Button>
                }
              >
                {t("meetings.editUpdatedElsewhere")}
              </Notice>
            ) : null}
            <section className="space-y-3" aria-labelledby={`${id}-details`}>
              <h3 id={`${id}-details`} className="text-overline text-muted-foreground">
                {t("meetings.editSectionDetails")}
              </h3>
              <FieldGroup className="gap-4">
                <Field data-invalid={showTitleError || undefined}>
                  <FieldLabel htmlFor={`${id}-title`}>{t("meetings.meetingTitle")}</FieldLabel>
                  <Input
                    ref={titleRef}
                    id={`${id}-title`}
                    value={title}
                    onChange={(e) => set("title")(e.target.value)}
                    required
                    aria-invalid={showTitleError || undefined}
                    aria-describedby={showTitleError ? `${id}-title-error` : undefined}
                  />
                  {showTitleError ? <FieldError id={`${id}-title-error`}>{t("meetings.titleRequired")}</FieldError> : null}
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
                    timeZone={timezone}
                    checkPast={startTouched}
                  />
                  <Field>
                    <FieldLabel htmlFor={`${id}-tz`}>{t("meetings.timezone")}</FieldLabel>
                    <Select
                      id={`${id}-tz`}
                      value={timezone}
                      onValueChange={(v) => v && set("timezone")(v)}
                      items={zones.map((tz) => ({ value: tz, label: meetingTimeZoneLabel(tz, i18n.language) }))}
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
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
