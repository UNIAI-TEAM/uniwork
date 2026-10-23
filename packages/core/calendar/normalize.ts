import type { CalendarEvent } from "./types";

/** FullCalendar all-day events use an exclusive `end` (day after last inclusive day). */
function addOneCalendarDay(ymd: string): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function isCanceledStatus(status: string | undefined): boolean {
  return status?.toLowerCase() === "canceled";
}

export function taskToCalendarEvent(task: {
  id: string;
  title: string;
  start_date?: string | null;
  due_date?: string | null;
  start_at?: string | null;
  due_at?: string | null;
  status?: string;
  priority?: string;
  project_id?: string | null;
}): CalendarEvent | null {
  const due = task.due_date?.trim();
  if (!due) {
    return null;
  }

  const startAt = task.start_at?.trim();
  const dueAt = task.due_at?.trim();
  if (startAt && dueAt) {
    return {
      id: `task:${task.id}`,
      kind: "task",
      entityId: task.id,
      title: task.title,
      start: startAt,
      end: dueAt,
      allDay: false,
      status: task.status,
      priority: task.priority,
      projectId: task.project_id,
    };
  }

  const start = task.start_date?.trim() || due;
  const end = addOneCalendarDay(due);

  return {
    id: `task:${task.id}`,
    kind: "task",
    entityId: task.id,
    title: task.title,
    start,
    end,
    allDay: true,
    status: task.status,
    priority: task.priority,
    projectId: task.project_id,
  };
}

export function meetingToCalendarEvent(meeting: {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status?: string;
}): CalendarEvent | null {
  if (isCanceledStatus(meeting.status)) {
    return null;
  }

  return {
    id: `meeting:${meeting.id}`,
    kind: "meeting",
    entityId: meeting.id,
    title: meeting.title,
    start: meeting.starts_at,
    end: meeting.ends_at,
    allDay: false,
    status: meeting.status,
  };
}
