export type CalendarEventKind = "task" | "meeting";

export type CalendarEvent = {
  id: string;
  kind: CalendarEventKind;
  entityId: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  status?: string;
  priority?: string;
  projectId?: string | null;
};
