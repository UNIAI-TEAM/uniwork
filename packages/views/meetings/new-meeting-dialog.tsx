"use client";
import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useCreateMeeting } from "@uniwork/core/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import { InfoHint } from "@uniwork/ui/components/common/info-hint";
import { Field, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { combineLocalIso, defaultScheduleDraft } from "./meeting-datetime";
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={trigger ?? <Button size="sm">{t("meetings.new")}</Button>}
      />
      <DialogContent className="flex max-h-[min(90dvh,44rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 space-y-0 border-b border-border bg-muted/20 px-5 py-4">
          <DialogTitle>{t("meetings.new")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={(e) => {
            e.preventDefault();
            if (!scheduleValid(start, end)) return;
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
                  setOpen(false);
                  reset();
                  toast.success(t("meetings.created"));
                  onCreated?.(m.id);
                },
                onError: (err) => toastApiError(err, t("common.error")),
              },
            );
          }}
        >
          <FieldGroup className="min-h-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-4">
            <Field>
              <FieldLabel htmlFor="m-title">
                {t("meetings.meetingTitle")}
              </FieldLabel>
              <Input
                id="m-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="m-desc">
                {t("meetings.description")}
              </FieldLabel>
              <Textarea
                id="m-desc"
                className="field-sizing-fixed max-h-24 resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </Field>
            <MeetingScheduleFields
              idPrefix="m"
              date={date}
              start={start}
              end={end}
              onDate={setDate}
              onStart={setStart}
              onEnd={setEnd}
            />
            <Field>
              <FieldLabel className="inline-flex items-center gap-1.5">
                {t("meetings.attendees")}
                <InfoHint label={t("meetings.youAreHost")}>
                  {t("meetings.youAreHost")}
                </InfoHint>
              </FieldLabel>
              <MemberMultiPicker
                workspaceId={workspaceId}
                value={attendees}
                onChange={setAttendees}
                excludeUserIds={userId ? [userId] : []}
              />
            </Field>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="text-pretty text-body text-foreground">
                  {t("meetings.allowJoinRequest")}
                </span>
                <InfoHint label={t("meetings.allowJoinRequestHint")}>
                  {t("meetings.allowJoinRequestHint")}
                </InfoHint>
              </div>
              <Switch
                className="shrink-0"
                checked={allowJoin}
                onCheckedChange={setAllowJoin}
              />
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-caption text-muted-foreground">
                {t("meetings.externalGuestLinks")}
              </span>
              <InfoHint label={t("meetings.externalGuestLinkAfterCreate")}>
                {t("meetings.externalGuestLinkAfterCreate")}
              </InfoHint>
            </div>
          </FieldGroup>
          <DialogFooter className="mx-0 mb-0 shrink-0 gap-3 rounded-none border-t border-border bg-muted/10 px-5 py-4 sm:flex-row sm:justify-end">
            <DialogClose render={<Button type="button" variant="outline" className="min-w-24" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="submit"
              className="min-w-24"
              disabled={
                create.isPending || !title.trim() || !date || !scheduleValid(start, end)
              }
            >
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
