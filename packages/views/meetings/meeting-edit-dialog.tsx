"use client";
import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateMeeting } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toast } from "sonner";
import { combineLocalIso, splitIsoLocal } from "./meeting-datetime";
import {
  browserTimeZone,
  MeetingScheduleFields,
  scheduleValid,
} from "./meeting-schedule-fields";

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
  const [allowJoin, setAllowJoin] = useState(
    meeting.allow_join_request !== false,
  );
  const inProgress = meeting.status === "IN_PROGRESS";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline">
              {t("meetings.edit")}
            </Button>
          )
        }
      />
      <DialogContent className="flex max-h-[min(90dvh,40rem)] flex-col sm:max-w-lg">
        <DialogTitle>{t("meetings.edit")}</DialogTitle>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!inProgress && !scheduleValid(start, end)) return;
            update.mutate(
              {
                title,
                description,
                timezone: browserTimeZone(),
                allow_join_request: allowJoin,
                ...(inProgress
                  ? {}
                  : {
                      starts_at: combineLocalIso(date, start),
                      ends_at: combineLocalIso(date, end),
                    }),
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
          <FieldGroup className="min-h-0 flex-1 overflow-y-auto">
            <Field>
              <FieldLabel htmlFor="edit-title">
                {t("meetings.meetingTitle")}
              </FieldLabel>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-desc">
                {t("meetings.description")}
              </FieldLabel>
              <Textarea
                id="edit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </Field>
            {inProgress ? null : (
              <MeetingScheduleFields
                idPrefix="edit"
                date={date}
                start={start}
                end={end}
                onDate={setDate}
                onStart={setStart}
                onEnd={setEnd}
              />
            )}
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span className="min-w-0 text-pretty text-body text-foreground">
                {t("meetings.allowJoinRequest")}
              </span>
              <Switch
                className="shrink-0"
                checked={allowJoin}
                onCheckedChange={setAllowJoin}
              />
            </label>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="submit"
              disabled={
                update.isPending ||
                !title.trim() ||
                (!inProgress && !scheduleValid(start, end))
              }
            >
              {t("meetings.saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
