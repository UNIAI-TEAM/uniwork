"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarClock, ListTodo, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { addHours } from "date-fns";
import { Button } from "@uniwork/ui/components/ui/button";
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
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: CalendarSlot | null;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const firstActionRef = useRef<HTMLButtonElement>(null);
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
    t("calendar.create_dock_no_time"),
  );

  useEffect(() => {
    if (!open) return;
    firstActionRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

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
      {open ? (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="absolute bottom-4 left-1/2 z-40 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-border/70 bg-popover/95 p-2 shadow-xl backdrop-blur-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClock
              aria-hidden
              className="ml-1 size-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <p id={titleId} className="truncate text-label font-medium">
                {t("calendar.create_item")}
              </p>
              <p className="truncate text-caption text-muted-foreground">{slotSummary}</p>
            </div>
            <Button
              ref={firstActionRef}
              type="button"
              size="sm"
              variant="secondary"
              onClick={pickTask}
            >
              <ListTodo aria-hidden />
              {t("calendar.create_task")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={pickMeeting}>
              <Video aria-hidden />
              {t("calendar.create_meeting")}
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("common.close")}
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden />
            </Button>
          </div>
        </section>
      ) : null}
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
