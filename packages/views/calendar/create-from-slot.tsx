"use client";

import { useMemo, useState } from "react";
import { ChevronRight, ListTodo, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { addHours } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { NewMeetingDialog } from "../meetings/new-meeting-dialog";
import { CreateTaskDialog } from "../tasks/create-task-dialog";
import {
  meetingScheduleFromSlot,
  taskDefaultsFromSlot,
  type CalendarSlot,
} from "./slot-prefill";

function formatSlotSummary(
  slot: CalendarSlot | null,
  language: string,
  allDayLabel: string,
  emptyLabel: string,
): string {
  if (!slot) return emptyLabel;
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(slot.start);
  if (slot.allDay) return `${date} · ${allDayLabel}`;

  const time = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time.format(slot.start)}–${time.format(slot.end ?? addHours(slot.start, 1))}`;
}

export function CreateFromSlot({
  workspaceId,
  open,
  onOpenChange,
  slot,
  anchor,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: CalendarSlot | null;
  anchor: HTMLElement | null;
}) {
  const { t, i18n } = useTranslation();
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
  const slotSummary = formatSlotSummary(
    slot,
    i18n.resolvedLanguage ?? i18n.language,
    t("calendar.all_day"),
    t("calendar.create_menu_no_time"),
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
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuContent
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          className="w-80 p-1.5"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1.5">
              <span className="block text-label text-foreground">
                {t("calendar.create_item")}
              </span>
              <span className="block font-normal text-caption text-muted-foreground">
                {slotSummary}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 px-2 py-2" onClick={pickTask}>
              <ListTodo aria-hidden className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-label font-medium">
                  {t("calendar.create_task")}
                </span>
                <span className="block truncate text-caption text-muted-foreground">
                  {t("calendar.create_task_hint")}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 px-2 py-2" onClick={pickMeeting}>
              <Video aria-hidden className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-label font-medium">
                  {t("calendar.create_meeting")}
                </span>
                <span className="block truncate text-caption text-muted-foreground">
                  {t("calendar.create_meeting_hint")}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {taskOpen ? (
        <CreateTaskDialog
          workspaceId={workspaceId}
          defaults={taskDefaults}
          open
          onOpenChange={setTaskOpen}
          showTrigger={false}
        />
      ) : null}
      {meetingOpen ? (
        <NewMeetingDialog
          workspaceId={workspaceId}
          scheduleDefaults={meetingSchedule}
          open
          onOpenChange={setMeetingOpen}
          showTrigger={false}
        />
      ) : null}
    </>
  );
}
