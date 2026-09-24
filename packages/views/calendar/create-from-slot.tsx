"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { NewMeetingDialog } from "../meetings/new-meeting-dialog";
import { CreateTaskDialog } from "../tasks/create-task-dialog";
import {
  meetingScheduleFromSlot,
  taskDefaultsFromSlot,
  type CalendarSlot,
} from "./slot-prefill";

export function CreateFromSlot({
  workspaceId,
  open,
  onOpenChange,
  slot,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: CalendarSlot | null;
}) {
  const { t } = useTranslation();
  const [taskOpen, setTaskOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);

  const taskDefaults = useMemo(
    () => (slot ? taskDefaultsFromSlot(slot) : undefined),
    [slot],
  );
  const meetingSchedule = useMemo(
    () => (slot ? meetingScheduleFromSlot(slot) : undefined),
    [slot],
  );

  const pickTask = () => {
    onOpenChange(false);
    setTaskOpen(true);
  };

  const pickMeeting = () => {
    onOpenChange(false);
    setMeetingOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t(slot ? "calendar.create_from_slot_title" : "calendar.create_item")}
            </DialogTitle>
            <DialogDescription>{t("calendar.create_from_slot_description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button type="button" className="w-full" onClick={pickTask}>
              {t("calendar.create_task")}
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={pickMeeting}>
              {t("calendar.create_meeting")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CreateTaskDialog
        workspaceId={workspaceId}
        defaults={taskDefaults}
        open={taskOpen}
        onOpenChange={setTaskOpen}
        showTrigger={false}
      />
      <NewMeetingDialog
        workspaceId={workspaceId}
        scheduleDefaults={meetingSchedule}
        open={meetingOpen}
        onOpenChange={setMeetingOpen}
        showTrigger={false}
      />
    </>
  );
}
