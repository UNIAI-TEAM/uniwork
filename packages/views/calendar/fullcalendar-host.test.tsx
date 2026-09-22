import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { FullCalendarHost } from "./fullcalendar-host";

type CapturedFcProps = {
  initialView?: string;
  hiddenDays?: number[];
  datesSet?: (arg: { start: Date; end: Date }) => void;
  eventClick?: (arg: { event: { id: string } }) => void;
};

let captured: CapturedFcProps = {};

vi.mock("@fullcalendar/react", () => ({
  default: (props: CapturedFcProps) => {
    captured = props;
    return <div data-testid="fc-inner" />;
  },
}));

vi.mock("@fullcalendar/daygrid", () => ({
  default: {},
}));

vi.mock("@fullcalendar/timegrid", () => ({
  default: {},
}));

vi.mock("@fullcalendar/interaction", () => ({
  default: {},
}));

const sample: CalendarEvent = {
  id: "ev-1",
  kind: "task",
  entityId: "task-1",
  title: "Demo",
  start: "2026-09-10",
  allDay: true,
};

describe("FullCalendarHost", () => {
  it("renders the grid wrapper and forwards datesSet as inclusive YYYY-MM-DD", () => {
    const onDatesSet = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={onDatesSet}
        onEventClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("calendar-grid")).toBeInTheDocument();
    captured.datesSet?.({
      start: new Date("2026-09-01T00:00:00"),
      end: new Date("2026-09-30T00:00:00"),
    });
    expect(onDatesSet).toHaveBeenCalledWith({ from: "2026-09-01", to: "2026-09-29" });
  });

  it("passes FC view and hiddenDays from viewMode", () => {
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="work_week"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.initialView).toBe("timeGridWeek");
    expect(captured.hiddenDays).toEqual([0, 6]);
  });

  it("resolves eventClick by id", () => {
    const onEventClick = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={onEventClick}
      />,
    );
    captured.eventClick?.({ event: { id: "ev-1" } });
    expect(onEventClick).toHaveBeenCalledWith(sample);
  });
});
