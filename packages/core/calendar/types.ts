export type CalendarEventKind = "task" | "meeting" | "external";

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
  provider?: "google" | "outlook";
  externalUrl?: string;
};

export type CalendarSidebarTask = {
  id: string;
  title: string;
  status: string;
  priority?: string;
  dueDate?: string;
};

export type CalendarSidebarMeeting = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
};

export type CalendarSidebar = {
  priorities: CalendarSidebarTask[];
  meetWith: CalendarSidebarMeeting[];
  assigned: CalendarSidebarTask[];
  todayOverdue: CalendarSidebarTask[];
  backlog: CalendarSidebarTask[];
};
