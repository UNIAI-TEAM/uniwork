"use client";

import { useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCalendarEvents } from "@uniwork/core/calendar";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { PAGE_GUTTER } from "../layout/page-header";
import { CalendarToolbar } from "./calendar-toolbar";
import { FullCalendarHost } from "./fullcalendar-host";

function monthRange(date: Date) {
  return {
    from: format(startOfMonth(date), "yyyy-MM-dd"),
    to: format(endOfMonth(date), "yyyy-MM-dd"),
  };
}

export function CalendarPageView({
  workspaceId,
  onOpenTask,
  onOpenMeeting,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
  onOpenMeeting: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [mine, setMine] = useState(false);
  const [range, setRange] = useState(() => monthRange(new Date()));

  const initialDate = format(anchorDate, "yyyy-MM-dd");
  const monthKey = format(anchorDate, "yyyy-MM");

  const { data, isError, isPending, refetch } = useCalendarEvents(
    workspaceId,
    range.from,
    range.to,
    mine,
  );
  const events = useMemo(() => data ?? [], [data]);

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
      <CalendarToolbar
        anchorDate={anchorDate}
        mine={mine}
        onAnchorDateChange={setAnchorDate}
        onMineChange={setMine}
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
            "flex min-h-0 flex-1 flex-col overflow-auto py-4",
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
            key={monthKey}
            events={events}
            initialDate={initialDate}
            onDatesSet={setRange}
            onEventClick={handleEventClick}
          />
        </div>
      )}
    </div>
  );
}
