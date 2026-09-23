"use client";

import { useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCalendarEvents, useCalendarSidebar } from "@uniwork/core/calendar";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { format } from "date-fns";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { PAGE_GUTTER } from "../layout/page-header";
import { CalendarToolbar } from "./calendar-toolbar";
import { type CalendarViewMode, rangeForMode } from "./calendar-view-mode";
import { useCalendarMutations } from "./calendar-mutations";
import { CreateFromSlot } from "./create-from-slot";
import { CalendarSidebar, EMPTY_CALENDAR_SIDEBAR } from "./calendar-sidebar";
import { FullCalendarHost, type CalendarSlot } from "./fullcalendar-host";
import { NewMeetingDialog } from "../meetings/new-meeting-dialog";

export function CalendarPageView({
  workspaceId,
  onOpenTask,
  onOpenMeeting,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
  onOpenMeeting: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [mine, setMine] = useState(false);
  const [showWeekends, setShowWeekends] = useState(true);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [range, setRange] = useState(() => rangeForMode("month", new Date()));
  const [slotMenuOpen, setSlotMenuOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null);
  const [createMeetingOpen, setCreateMeetingOpen] = useState(false);
  const viewerTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  const initialDate = format(anchorDate, "yyyy-MM-dd");

  const { data, isError, isPending, isRefetching, refetch } = useCalendarEvents(
    workspaceId,
    range.from,
    range.to,
    mine,
  );
  const sidebarQuery = useCalendarSidebar(workspaceId);
  const sidebarSections = sidebarQuery.data ?? EMPTY_CALENDAR_SIDEBAR;
  const events = useMemo(() => data ?? [], [data]);
  const { applyDropPatch, applyExternalTaskDue } = useCalendarMutations(workspaceId);

  const handleAnchorDateChange = (next: Date) => {
    setAnchorDate(next);
    setRange(rangeForMode(viewMode, next));
  };

  const handleViewModeChange = (mode: CalendarViewMode) => {
    setViewMode(mode);
    setRange(rangeForMode(mode, anchorDate));
  };

  /** FullCalendar fires datesSet on option churn; skip no-op range updates to avoid loops. */
  const handleDatesSet = (next: { from: string; to: string }) => {
    setRange((prev) =>
      prev.from === next.from && prev.to === next.to ? prev : next,
    );
  };

  const handleSlotSelect = (slot: CalendarSlot) => {
    setSelectedSlot(slot);
    setSlotMenuOpen(true);
  };

  const handleQuickCreate = () => {
    setSelectedSlot(null);
    setSlotMenuOpen(true);
  };

  const handleExternalTaskReceive = async (input: { taskId: string; dueDate: string }) => {
    const calendarEvent = events.find(
      (ev) => ev.kind === "task" && ev.entityId === input.taskId,
    );
    await applyExternalTaskDue({ ...input, calendarEvent });
  };

  const handleEventClick = (event: CalendarEvent) => {
    if (event.kind === "task") {
      onOpenTask(event.entityId);
      return;
    }
    onOpenMeeting(event.entityId);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <CollectionPageHeader
        icon={Calendar}
        tone={moduleTone("calendar")}
        title={t("calendar.title")}
      />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <CalendarSidebar
          workspaceId={workspaceId}
          viewerTimeZone={viewerTimeZone}
          sections={sidebarSections}
          isPending={sidebarQuery.isPending}
          isError={sidebarQuery.isError}
          onRetry={() => void sidebarQuery.refetch()}
          onOpenTask={onOpenTask}
          onOpenMeeting={onOpenMeeting}
          onCreateMeeting={() => setCreateMeetingOpen(true)}
          onQuickCreate={handleQuickCreate}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CalendarToolbar
            anchorDate={anchorDate}
            mine={mine}
            showWeekends={showWeekends}
            viewMode={viewMode}
            workspaceId={workspaceId}
            exportFrom={range.from}
            exportTo={range.to}
            isRefreshing={isRefetching || sidebarQuery.isRefetching}
            onAnchorDateChange={handleAnchorDateChange}
            onMineChange={setMine}
            onRefresh={() => {
              void Promise.all([refetch(), sidebarQuery.refetch()]);
            }}
            onShowWeekendsChange={setShowWeekends}
            onViewModeChange={handleViewModeChange}
          />
          {isError ? (
            <CollectionPageState
              icon={Calendar}
              tone="destructive"
              role="alert"
              title={t("calendar.error")}
              actions={
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  {t("calendar.retry")}
                </Button>
              }
            />
          ) : (
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-hidden py-4",
                PAGE_GUTTER,
                isPending ? "opacity-70" : undefined,
              )}
              aria-busy={isPending}
            >
              {isPending ? (
                <p className="sr-only">{t("calendar.loading")}</p>
              ) : null}
              {isPending ? <Skeleton className="mb-4 h-8 w-full max-w-md" /> : null}
              <FullCalendarHost
                events={events}
                initialDate={initialDate}
                viewMode={viewMode}
                showWeekends={showWeekends}
                language={i18n.resolvedLanguage ?? i18n.language}
                viewerTimeZone={viewerTimeZone}
                onDatesSet={handleDatesSet}
                onEventClick={handleEventClick}
                onEventDropOrResize={applyDropPatch}
                onExternalTaskReceive={handleExternalTaskReceive}
                onSlotSelect={handleSlotSelect}
              />
              <CreateFromSlot
                workspaceId={workspaceId}
                open={slotMenuOpen}
                onOpenChange={setSlotMenuOpen}
                slot={selectedSlot}
              />
            </div>
          )}
        </div>
      </div>
      <NewMeetingDialog
        workspaceId={workspaceId}
        open={createMeetingOpen}
        onOpenChange={setCreateMeetingOpen}
        showTrigger={false}
        onCreated={onOpenMeeting}
      />
    </div>
  );
}
