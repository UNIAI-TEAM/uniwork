"use client";
import { useId, useState, type ReactElement } from "react";
import { Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCreateMeeting } from "@uniwork/core/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
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
import {
  combineLocalIso,
  defaultScheduleDraft,
  scheduleDraftFromDefaults,
  type ScheduleDraft,
} from "./meeting-datetime";
import { MemberMultiPicker } from "./member-multi-picker";
import {
  browserTimeZone,
  MeetingScheduleFields,
  scheduleValid,
} from "./meeting-schedule-fields";

export function NewMeetingDialog({
  workspaceId,
  onCreated,
  trigger,
  scheduleDefaults,
}: {
  workspaceId: string;
  onCreated?: (id: string) => void;
  trigger?: ReactElement;
  /** Local wall date/times; same shape as `defaultScheduleDraft`. */
  scheduleDefaults?: ScheduleDraft;
}) {
  const { t } = useTranslation();
  const id = useId();
  const userId = useAuthStore((s) => s.user?.id);
  const create = useCreateMeeting(workspaceId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => scheduleDraftFromDefaults(scheduleDefaults).date);
  const [start, setStart] = useState(() => scheduleDraftFromDefaults(scheduleDefaults).start);
  const [end, setEnd] = useState(() => scheduleDraftFromDefaults(scheduleDefaults).end);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [allowJoin, setAllowJoin] = useState(true);

  const reset = () => {
    const next = defaultScheduleDraft();
    setTitle("");
    setDescription("");
    setDate(next.date);
    setStart(next.start);
    setEnd(next.end);
    setAttendees([]);
    setAllowJoin(true);
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      const draft = scheduleDraftFromDefaults(scheduleDefaults);
      setDate(draft.date);
      setStart(draft.start);
      setEnd(draft.end);
    } else {
      reset();
    }
  };

  const titleMissing = !title.trim();
  const ready = !titleMissing && Boolean(date) && scheduleValid(start, end);

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger ?? <Button size="sm">{t("meetings.new")}</Button>} />
      <FormDialogContent size="lg">
        <FormDialogHeader title={t("meetings.new")} description={t("meetings.newDescription")} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            create.mutate(
              {
                title,
                description,
                starts_at: combineLocalIso(date, start),
                ends_at: combineLocalIso(date, end),
                timezone: browserTimeZone(),
                allow_join_request: allowJoin,
                attendee_user_ids: attendees,
              },
              {
                onSuccess: (m) => {
                  if (!m) {
                    toast.error(t("common.error"));
                    return;
                  }
                  changeOpen(false);
                  toast.success(t("meetings.created"));
                  onCreated?.(m.id);
                },
                onError: (err) => toastApiError(err, t("common.error")),
              },
            );
          }}
        >
          <FormDialogBody>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor={`${id}-title`}>{t("meetings.meetingTitle")}</FieldLabel>
                <Input
                  id={`${id}-title`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-desc`}>{t("meetings.description")}</FieldLabel>
                <Textarea
                  id={`${id}-desc`}
                  className="field-sizing-fixed max-h-24 resize-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </Field>
              <MeetingScheduleFields
                idPrefix={id}
                date={date}
                start={start}
                end={end}
                onDate={setDate}
                onStart={setStart}
                onEnd={setEnd}
              />
              <Field aria-labelledby={`${id}-attendees`}>
                <FieldLabel id={`${id}-attendees`}>{t("meetings.attendees")}</FieldLabel>
                <FieldDescription>{t("meetings.youAreHost")}</FieldDescription>
                <MemberMultiPicker
                  workspaceId={workspaceId}
                  value={attendees}
                  onChange={setAttendees}
                  excludeUserIds={userId ? [userId] : []}
                />
              </Field>
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
                  onCheckedChange={setAllowJoin}
                />
              </div>
              <Notice tone="info" icon={Link2} layout="inline" live="off">
                {t("meetings.externalGuestLinkAfterCreate")}
              </Notice>
            </FieldGroup>
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => changeOpen(false)}
            submitType="submit"
            submitLabel={t("meetings.createSubmit")}
            submittingLabel={t("meetings.creating")}
            submitting={create.isPending}
            submitDisabled={!ready}
            leading={titleMissing ? t("meetings.titleRequired") : undefined}
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
