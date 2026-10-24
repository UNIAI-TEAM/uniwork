"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
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
import { clockRange, longDay } from "../meetings/meeting-detail/format";
import { browserTimeZone } from "../meetings/meeting-schedule-fields";
import { MeetingSheet } from "../meetings/meeting-sheet";
import { emptyDraft, type MeetingDraft } from "../meetings/meeting-sheet/draft-model";
import { useNow } from "../meetings/use-now";
import { CreateTaskDialog } from "../tasks/create-task-dialog";
import { MeetingQuickCard } from "./meeting-quick-card";
import {
  meetingScheduleFromSlot,
  taskDefaultsFromSlot,
  type CalendarSlot,
} from "./slot-prefill";
import { MODULE_ICONS } from "../layout/module-icons";

/** "Thứ Hai 26/10 · 10:00–11:00" (board CreateFromSlot), or the day and "Cả ngày". */
function formatSlotSummary(slot: CalendarSlot | null, nowMs: number, t: ReturnType<typeof useTranslation>["t"]): string {
  if (!slot) return t("calendar.create_menu_no_time");
  const startIso = slot.start.toISOString();
  const day = longDay(startIso, nowMs, t);
  if (slot.allDay) return `${day} · ${t("calendar.all_day")}`;
  return `${day} · ${clockRange(startIso, (slot.end ?? addHours(slot.start, 1)).toISOString())}`;
}

export function CreateFromSlot({
  workspaceId,
  open,
  onOpenChange,
  slot,
  anchor,
  onOpenMeeting,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: CalendarSlot | null;
  anchor: HTMLElement | null;
  /** The toast's [Mở] after a create from the quick card. */
  onOpenMeeting: (meetingId: string) => void;
}) {
  const { t } = useTranslation();
  const [taskOpen, setTaskOpen] = useState(false);
  const [card, setCard] = useState<MeetingDraft | null>(null);
  const [sheetDraft, setSheetDraft] = useState<MeetingDraft | undefined>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const taskDefaults = useMemo(
    () => (slot ? taskDefaultsFromSlot(slot) : undefined),
    [slot],
  );
  const nowMs = useNow();
  const meetingPassed = slot ? meetingScheduleFromSlot(slot, nowMs) === null : false;
  const slotSummary = formatSlotSummary(slot, nowMs, t);

  const pickTask = () => {
    onOpenChange(false);
    setTaskOpen(true);
  };

  const pickMeeting = () => {
    // The menu can sit open across a minute boundary; decide on the clock now.
    const now = Date.now();
    const schedule = slot ? meetingScheduleFromSlot(slot, now) : undefined;
    if (schedule === null) return;
    onOpenChange(false);
    setCard({ ...emptyDraft(now, browserTimeZone()), ...schedule });
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuContent
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          className="w-85 p-1"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="mb-1 border-b border-border px-2.5 pt-2 pb-2.5">
              <span className="block text-label text-foreground">
                {t("calendar.create_item")}
              </span>
              <span className="block font-normal text-caption text-muted-foreground tabular-nums">
                {slotSummary}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuItem className="min-h-13 gap-2.5 px-2.5 py-2" onClick={pickTask}>
              <MODULE_ICONS.tasks aria-hidden className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">
                  {t("calendar.create_task")}
                </span>
                <span className="block truncate text-caption text-muted-foreground">
                  {t("calendar.create_task_hint")}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-13 gap-2.5 px-2.5 py-2"
              disabled={meetingPassed}
              onClick={pickMeeting}
            >
              <MODULE_ICONS.meetings aria-hidden className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">
                  {t("calendar.create_meeting")}
                </span>
                <span className="block truncate text-caption text-muted-foreground">
                  {meetingPassed
                    ? t("calendar.create_meeting_past_hint")
                    : t("calendar.create_meeting_hint")}
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
      {card ? (
        <MeetingQuickCard
          workspaceId={workspaceId}
          initial={card}
          anchor={anchor}
          onClose={() => setCard(null)}
          onOpenMeeting={onOpenMeeting}
          onMoreOptions={(draft) => {
            setCard(null);
            setSheetDraft(draft);
            setSheetOpen(true);
          }}
        />
      ) : null}
      {/* Mounted for good: a run closed mid-way reopens its result panel through it. */}
      <MeetingSheet
        mode="create"
        workspaceId={workspaceId}
        initialDraft={sheetDraft}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        showTrigger={false}
      />
    </>
  );
}
