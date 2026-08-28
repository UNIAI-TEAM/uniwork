"use client";
import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useCreateMeeting } from "@uniwork/core/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { TimeInput } from "@uniwork/ui/components/ui/time-input";
import { toast } from "sonner";
import { combineLocalIso, defaultScheduleDraft, MEETING_TIMEZONES } from "./meeting-datetime";
import { MemberMultiPicker } from "./member-multi-picker";

export function NewMeetingDialog({
  workspaceId,
  onCreated,
  trigger,
}: {
  workspaceId: string;
  onCreated?: (id: string) => void;
  trigger?: ReactElement;
}) {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id);
  const create = useCreateMeeting(workspaceId);
  const draft = defaultScheduleDraft();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState(draft.start);
  const [end, setEnd] = useState(draft.end);
  const [timezone, setTimezone] = useState("Asia/Ho_Chi_Minh");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [allowJoin, setAllowJoin] = useState(true);

  const reset = () => {
    const next = defaultScheduleDraft();
    setTitle("");
    setDescription("");
    setDate(next.date);
    setStart(next.start);
    setEnd(next.end);
    setTimezone("Asia/Ho_Chi_Minh");
    setAttendees([]);
    setAllowJoin(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={trigger ?? <Button size="sm">{t("meetings.new")}</Button>} />
      <DialogContent className="max-h-[min(90dvh,40rem)] overflow-y-auto sm:max-w-lg">
        <DialogTitle>{t("meetings.new")}</DialogTitle>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                title,
                description,
                starts_at: combineLocalIso(date, start),
                ends_at: combineLocalIso(date, end),
                timezone,
                allow_join_request: allowJoin,
                attendee_user_ids: attendees,
              },
              {
                onSuccess: (m) => {
                  if (!m) {
                    toast.error(t("common.error"));
                    return;
                  }
                  setOpen(false);
                  reset();
                  toast.success(t("common.create"));
                  onCreated?.(m.id);
                },
                onError: () => toast.error(t("common.error")),
              },
            );
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="m-title">{t("meetings.meetingTitle")}</FieldLabel>
              <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="m-desc">{t("meetings.description")}</FieldLabel>
              <Textarea id="m-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </Field>
            <Field>
              <FieldLabel htmlFor="m-date">{t("meetings.date")}</FieldLabel>
              <Input id="m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
            <p className="text-label text-muted-foreground">{t("meetings.youAreHost")}</p>
            <Field>
              <FieldLabel>{t("meetings.attendees")}</FieldLabel>
              <MemberMultiPicker
                workspaceId={workspaceId}
                value={attendees}
                onChange={setAttendees}
                excludeUserIds={userId ? [userId] : []}
              />
            </Field>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span className="min-w-0 text-pretty text-body text-foreground">{t("meetings.allowJoinRequest")}</span>
              <Switch className="shrink-0" checked={allowJoin} onCheckedChange={setAllowJoin} />
            </label>
          </FieldGroup>
          <Button type="submit" disabled={create.isPending}>
            {t("common.create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
