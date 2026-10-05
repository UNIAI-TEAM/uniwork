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

    fireEvent.click(screen.getByRole("button", { name: /Không diễn ra/ }));
    expect(onStatus).toHaveBeenCalledWith("MISSED");
  });

  it("gives missed meetings their own chip and count, apart from the ones not started", () => {
    render(
      <MeetingFilters
        status=""
        query=""
        stats={{ total: 12, scheduled: 3, missed: 5, in_progress: 2, ended: 1, canceled: 1 }}
        onStatus={() => {}}
        onQuery={() => {}}
      />,
    );
    // The figure is for the eye; a screen reader hears what it counts.
    expect(screen.getByRole("button", { name: "Chưa bắt đầu 3 cuộc họp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Không diễn ra 5 cuộc họp" })).toBeInTheDocument();
  });

  it("lists the chips in the order a meeting lives them", () => {
    render(<MeetingFilters status="" query="" stats={null} onStatus={() => {}} onQuery={() => {}} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Tất cả",
      "Chưa bắt đầu",
      "Đang diễn ra",
      "Đã kết thúc",
      "Không diễn ra",
      "Đã hủy",
    ]);
  });

  it("shows no missed count to a server that does not send one", () => {
    render(
      <MeetingFilters
        status="MISSED"
        query=""
        stats={{ total: 10, scheduled: 3, in_progress: 2, ended: 4, canceled: 1 }}
        onStatus={() => {}}
        onQuery={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Không diễn ra", pressed: true })).toBeInTheDocument();
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

describe("MeetingFilters while searching", () => {
  it("hides the chip counts, which count the whole workspace and not the search", () => {
    render(
      <MeetingFilters
        status=""
        query="retro"
        stats={{ total: 10, scheduled: 3, in_progress: 2, ended: 4, canceled: 1 }}
        onStatus={() => {}}
        onQuery={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Đã kết thúc" })).toBeInTheDocument();
    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });

  it("counts again once the search is only whitespace", () => {
    render(
      <MeetingFilters
        status=""
        query="  "
        stats={{ total: 10, scheduled: 3, in_progress: 2, ended: 4, canceled: 1 }}
        onStatus={() => {}}
        onQuery={() => {}}
      />,
    );
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("wraps the chips on a narrow screen instead of scrolling them out of sight", () => {
    render(<MeetingFilters status="" query="" stats={null} onStatus={() => {}} onQuery={() => {}} />);
    const group = screen.getByRole("group", { name: "Trạng thái" });
    expect(group).toHaveClass("flex-wrap");
    expect(group).not.toHaveClass("overflow-x-auto");
  });
});

describe("chip and badge agreement", () => {
  // The server splits stored SCHEDULED rows on ends_at exactly where the badge
  // does (MeetingService.ListFiltered, ends_at < now is MISSED), and matches
  // every other chip on the stored status. Every badge a chip's rows can carry
  // must be one the chip's label covers, or the chip lies about what it lists.
  const endsAt = "2026-09-03T10:00:00.000Z";
  const before = Date.parse("2026-09-03T09:00:00.000Z");
  const atEnd = Date.parse(endsAt);
  const after = Date.parse("2026-09-03T11:00:00.000Z");
  // The rows each chip gets back from the server, as (stored status, clock) pairs.
  const served: Record<string, Array<[string, number]>> = {
    SCHEDULED: [["SCHEDULED", before], ["SCHEDULED", atEnd]],
    MISSED: [["SCHEDULED", after]],
    IN_PROGRESS: [["IN_PROGRESS", before], ["IN_PROGRESS", after]],
    ENDED: [["ENDED", before], ["ENDED", after]],
    CANCELED: [["CANCELED", before], ["CANCELED", after]],
  };

  it("covers every chip", () => {
    expect(Object.keys(served).sort()).toEqual(Object.keys(MEETING_FILTER_SHOWS).sort());
  });

  it.each(Object.keys(served))("every row the %s chip lists wears a badge it covers", (chip) => {
    for (const [status, now] of served[chip] ?? []) {
      expect(MEETING_FILTER_SHOWS[chip]).toContain(displayMeetingStatus({ ends_at: endsAt, status }, now));
    }
  });

  it("keeps missed meetings out of the not-started chip", () => {
    expect(MEETING_FILTER_SHOWS.SCHEDULED).not.toContain("MISSED");
  });
});
