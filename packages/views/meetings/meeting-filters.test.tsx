import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingFilters } from "./meeting-filters";

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

    fireEvent.click(screen.getByRole("button", { name: /Tất cả/ }));
    expect(onStatus).toHaveBeenCalledWith("");

    fireEvent.click(screen.getByRole("button", { name: /Đã lên lịch/ }));
    expect(onStatus).toHaveBeenCalledWith("SCHEDULED");

    fireEvent.click(screen.getByRole("button", { name: /Đã kết thúc/ }));
    expect(onStatus).toHaveBeenCalledWith("ENDED");

    fireEvent.click(screen.getByRole("button", { name: /Đã huỷ/ }));
    expect(onStatus).toHaveBeenCalledWith("CANCELED");
  });

  it("omits counts when statistics are unavailable", () => {
    render(
      <MeetingFilters status="SCHEDULED" query="" stats={null} onStatus={() => {}} onQuery={() => {}} />,
    );

    expect(screen.getByRole("button", { name: "Đã lên lịch", pressed: true })).toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Đã lên lịch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Đã kết thúc/ })).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
