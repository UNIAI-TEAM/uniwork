import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { wrap } from "../test/api-mock";
import { CalendarPageView } from "./calendar-page";

initI18n();

const taskEvent: CalendarEvent = {
  id: "cal-task-1",
  kind: "task",
  entityId: "task-1",
  title: "Ship calendar",
  start: "2026-09-10",
  allDay: true,
};

vi.mock("@uniwork/core/calendar", () => ({
  useCalendarEvents: () => ({
    data: [taskEvent],
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("./fullcalendar-host", () => ({
  FullCalendarHost: () => <div data-testid="calendar-grid" />,
}));

describe("CalendarPageView", () => {
  it("shows the calendar title and month grid", () => {
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Lịch" })).toBeInTheDocument();
    expect(screen.getByTestId("calendar-grid")).toBeInTheDocument();
  });
});
