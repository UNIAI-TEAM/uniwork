import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { displayMeetingStatus } from "@uniwork/core/meetings";
import { initI18n } from "@uniwork/core/i18n";
import { MEETING_FILTER_SHOWS, MeetingFilters } from "./meeting-filters";

beforeAll(() => {
  initI18n();
});

describe("MeetingFilters", () => {
  it("searches and filters by status with counts", () => {
    const onStatus = vi.fn();
    const onQuery = vi.fn();
    render(
      <MeetingFilters
        status=""
        query=""
        stats={{ total: 10, scheduled: 3, in_progress: 2, ended: 4, canceled: 1 }}
        onStatus={onStatus}
        onQuery={onQuery}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "standup" } });
    expect(onQuery).toHaveBeenCalledWith("standup");

    fireEvent.click(screen.getByRole("button", { name: /Đang diễn ra/ }));
    expect(onStatus).toHaveBeenCalledWith("IN_PROGRESS");

    fireEvent.click(screen.getByRole("button", { name: /Chưa bắt đầu/ }));
    expect(onStatus).toHaveBeenCalledWith("SCHEDULED");

    fireEvent.click(screen.getByRole("button", { name: /Đã kết thúc/ }));
    expect(onStatus).toHaveBeenCalledWith("ENDED");

    fireEvent.click(screen.getByRole("button", { name: /Đã hủy/ }));
    expect(onStatus).toHaveBeenCalledWith("CANCELED");
  });

  it("goes back to all from a status", () => {
    const onStatus = vi.fn();
    render(<MeetingFilters status="ENDED" query="" stats={null} onStatus={onStatus} onQuery={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Tất cả/ }));
    expect(onStatus).toHaveBeenCalledWith("");
  });

  it("shows counts in tabular figures", () => {
    render(
      <MeetingFilters
        status=""
        query=""
        stats={{ total: 10, scheduled: 3, in_progress: 2, ended: 4, canceled: 1 }}
        onStatus={() => {}}
        onQuery={() => {}}
      />,
    );
    expect(screen.getByText("3")).toHaveClass("tabular-nums");
  });

  it("omits counts when statistics are unavailable", () => {
    render(<MeetingFilters status="SCHEDULED" query="" stats={null} onStatus={() => {}} onQuery={() => {}} />);

    expect(screen.getByRole("button", { name: "Chưa bắt đầu", pressed: true })).toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("hides zero counts on filter chips", () => {
    render(
      <MeetingFilters
        status=""
        query=""
        stats={{ total: 1, scheduled: 0, in_progress: 0, ended: 1, canceled: 0 }}
        onStatus={() => {}}
        onQuery={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Chưa bắt đầu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Đã kết thúc/ })).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("chip and badge agreement", () => {
  // The server filters by stored status; the row badge shows the status as the
  // viewer's clock sees it. Every badge a chip's rows can carry must be one the
  // chip's label covers, or the chip lies about what it lists.
  const endsAt = "2026-09-03T10:00:00.000Z";
  const clocks = [Date.parse("2026-09-03T09:00:00.000Z"), Date.parse("2026-09-03T11:00:00.000Z")];

  it.each(Object.keys(MEETING_FILTER_SHOWS))("every row the %s chip lists wears a badge it covers", (status) => {
    for (const now of clocks) {
      expect(MEETING_FILTER_SHOWS[status]).toContain(displayMeetingStatus({ ends_at: endsAt, status }, now));
    }
  });

  it("does not call a chip that also lists missed meetings 'Đã lên lịch'", () => {
    render(<MeetingFilters status="" query="" stats={null} onStatus={() => {}} onQuery={() => {}} />);
    expect(MEETING_FILTER_SHOWS.SCHEDULED).toContain("MISSED");
    expect(screen.queryByRole("button", { name: "Đã lên lịch" })).not.toBeInTheDocument();
  });
});
