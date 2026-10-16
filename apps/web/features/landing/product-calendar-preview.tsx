"use client";

import { useState, type ComponentProps } from "react";
import { Download, Link2, PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { useIsCompact } from "@uniwork/ui/hooks/use-mobile";
import { Input } from "@uniwork/ui/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { CollectionPageHeader } from "@uniwork/views/layout/collection-page";
import { MODULE_ICONS } from "@uniwork/views/layout/module-icons";
import { CalendarToolbar } from "@uniwork/views/calendar/calendar-toolbar";
import { CalendarSidebar } from "@uniwork/views/calendar/calendar-sidebar";
import { FullCalendarHost } from "@uniwork/views/calendar/fullcalendar-host";
import { CalendarFloatingSearch } from "@uniwork/views/calendar/calendar-floating-search";
import { shiftAnchor } from "@uniwork/views/calendar/calendar-view-mode";

export function ProductCalendarPreview({ onTask, onMeeting }: { onTask: () => void; onMeeting: () => void }) {
  const { t, i18n } = useTranslation();
  const compact = useIsCompact();
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [anchor, setAnchor] = useState(new Date("2026-10-16T09:00:00+07:00"));
  const [mode, setMode] = useState<ComponentProps<typeof CalendarToolbar>["viewMode"] | null>(null);
  const viewMode = mode ?? (compact ? "day" : "week");
  const [mine, setMine] = useState(false);
  const [weekends, setWeekends] = useState(true);
  const [events, setEvents] = useState<CalendarEvent[]>(() => [
    { id: "calendar-design", kind: "task", entityId: "design", title: t("landing.productDemo.board.tasks.design"), start: "2026-10-16", allDay: true, status: "in_progress", priority: "high" },
    { id: "calendar-sync", kind: "meeting", entityId: "sync", title: t("landing.lovable.sync"), start: "2026-10-16T09:30:00+07:00", end: "2026-10-16T10:00:00+07:00", allDay: false, status: "SCHEDULED" },
    { id: "calendar-review", kind: "meeting", entityId: "review", title: t("landing.lovable.designReview"), start: "2026-10-15T14:00:00+07:00", end: "2026-10-15T15:00:00+07:00", allDay: false, status: "SCHEDULED" },
  ]);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("2026-10-16T14:00");
  const [notice, setNotice] = useState("");
  const tasks = events.filter(event => event.kind === "task").map(event => ({ id: event.entityId, title: event.title, status: event.status ?? "todo", priority: event.priority, dueDate: event.start.slice(0, 10) }));
  const moveEvent: NonNullable<ComponentProps<typeof FullCalendarHost>["onEventDropOrResize"]> = patch => {
    setEvents(current => current.map(event => event.entityId !== patch.entityId ? event : patch.kind === "meeting" ? { ...event, start: patch.body.starts_at, end: patch.body.ends_at } : { ...event, start: patch.patch.start_at ?? patch.patch.due_at ?? patch.patch.start_date ?? patch.patch.due_date ?? event.start }));
  };
  const exportIcs = () => {
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UniWork//Demo//EN", ...events.flatMap(event => ["BEGIN:VEVENT", `UID:${event.id}@uniwork.example`, `DTSTART;VALUE=DATE:${event.start.slice(0, 10).replaceAll("-", "")}`, `SUMMARY:${event.title.replaceAll("\n", " ")}`, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); const link = document.createElement("a"); link.href = url; link.download = "uniwork-demo.ics"; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="product-current-calendar"><CollectionPageHeader headingAs="h2" icon={MODULE_ICONS.calendar} tone="yellow" title={t("calendar.title")} actions={<Button className="md:hidden" variant="outline" size="sm" aria-expanded={plannerOpen} onClick={() => setPlannerOpen(value => !value)}><PanelLeft aria-hidden />{t("calendar.planner_title")}</Button>} /><div className="product-current-calendar-body">
    <div className="product-current-calendar-planner" data-open={plannerOpen}><CalendarSidebar workspaceId="" viewerTimeZone="Asia/Saigon" sections={{ priorities: tasks.slice(0, 1), assigned: tasks, todayOverdue: [], backlog: [], meetWith: events.filter(event => event.kind === "meeting").map(event => ({ id: event.entityId, title: event.title, startsAt: event.start, endsAt: event.end ?? event.start })) }} onRetry={() => {}} onOpenTask={onTask} onOpenMeeting={onMeeting} onCreateMeeting={() => setCreating(true)} onQuickCreate={() => setCreating(true)} /></div>
    <div className="product-current-calendar-grid"><CalendarToolbar className="product-calendar-toolbar" anchorDate={anchor} mine={mine} showWeekends={weekends} viewMode={viewMode} workspaceId="" isRefreshing={false} onAnchorDateChange={setAnchor} onMineChange={setMine} onRefresh={() => setNotice(t("landing.productDemo.saved"))} onShowWeekendsChange={setWeekends} onViewModeChange={setMode} connectionsAction={<Button variant="toolbar" size="icon-sm" aria-label={t("calendar.connected_calendars")} onClick={() => setNotice(t("landing.lovable.sample"))}><Link2 aria-hidden className="size-4" /></Button>} exportAction={<Button variant="toolbar" size="icon-sm" aria-label={t("calendar.export_ics")} onClick={exportIcs}><Download aria-hidden className="size-4" /></Button>} />
      <FullCalendarHost events={mine ? events.filter(event => event.kind === "task") : events} initialDate={`${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-${String(anchor.getDate()).padStart(2, "0")}`} viewMode={viewMode} showWeekends={weekends} language={i18n.language} viewerTimeZone="Asia/Saigon" scrollTime="08:00:00" onDatesSet={() => {}} onEventClick={setSelected} editable onEventDropOrResize={moveEvent} onSlotSelect={slot => { setStart(`${slot.start.getFullYear()}-${String(slot.start.getMonth() + 1).padStart(2, "0")}-${String(slot.start.getDate()).padStart(2, "0")}T${String(slot.start.getHours()).padStart(2, "0")}:${String(slot.start.getMinutes()).padStart(2, "0")}`); setTitle(""); setCreating(true); }} />
      <CalendarFloatingSearch tasks={tasks} events={events} viewMode={viewMode} showWeekends={weekends} viewerTimeZone="Asia/Saigon" onOpenTask={onTask} onOpenEvent={setSelected} onGoToday={() => setAnchor(new Date())} onPreviousPeriod={() => setAnchor(current => shiftAnchor(viewMode, current, -1))} onNextPeriod={() => setAnchor(current => shiftAnchor(viewMode, current, 1))} onRefresh={() => setNotice(t("landing.productDemo.saved"))} onShowWeekendsChange={setWeekends} onViewModeChange={setMode} />
    </div></div>{notice && <p className="product-documents-notice" role="status">{notice}</p>}
    <Dialog open={creating || !!selected} onOpenChange={open => { if (!open) { setCreating(false); setSelected(null); } }}><DialogContent><DialogHeader><DialogTitle>{selected?.title ?? t("calendar.title")}</DialogTitle><DialogDescription>{t("landing.lovable.sample")}</DialogDescription></DialogHeader>{selected ? <><p>{selected.start}</p><Button onClick={() => { setSelected(null); if (selected.kind === "task") onTask(); else onMeeting(); }}>{t(selected.kind === "task" ? "tasks.title" : "meetings.title")}</Button></> : <form onSubmit={event => { event.preventDefault(); const id = `calendar-local-${events.length}`; setEvents(current => [...current, { id, entityId: id, kind: "meeting", title, start: `${start}:00+07:00`, allDay: false, status: "SCHEDULED" }]); setCreating(false); }}><label>{t("meetings.meetingTitle")}<Input required value={title} onChange={event => setTitle(event.target.value)} /></label><label>{t("meetings.startsAt")}<Input type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></label><DialogFooter className="mt-4"><Button type="submit" disabled={!title.trim()}>{t("common.create")}</Button></DialogFooter></form>}</DialogContent></Dialog>
  </div>;
}
