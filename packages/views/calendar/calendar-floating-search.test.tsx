import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { CalendarFloatingSearch } from "./calendar-floating-search";

initI18n();

const task = {
  id: "task-1",
  identifier: "SAT-14",
  title: "Chuẩn bị báo cáo quý",
  status: "in_progress",
  dueDate: "2026-09-30",
};

const meeting: CalendarEvent = {
  id: "event-meeting-1",
  kind: "meeting",
  entityId: "meeting-1",
  title: "Họp kế hoạch tuần",
  start: "2026-09-29T08:30:00Z",
  end: "2026-09-29T09:00:00Z",
  allDay: false,
};

function renderSearch() {
  const callbacks = {
    onOpenTask: vi.fn(),
    onOpenEvent: vi.fn(),
    onGoToday: vi.fn(),
    onPreviousPeriod: vi.fn(),
    onNextPeriod: vi.fn(),
    onRefresh: vi.fn(),
    onShowWeekendsChange: vi.fn(),
    onViewModeChange: vi.fn(),
  };

  render(
    <CalendarFloatingSearch
      tasks={[task]}
      events={[meeting]}
      viewMode="work_week"
      showWeekends
      viewerTimeZone="Asia/Ho_Chi_Minh"
      {...callbacks}
    />,
  );

  return callbacks;
}

describe("CalendarFloatingSearch", () => {
  it("mở panel hướng lên từ dock thu gọn và đưa focus vào ô tìm kiếm", () => {
    renderSearch();

    fireEvent.click(
      screen.getByRole("button", { name: "Tìm việc, sự kiện hoặc lệnh lịch" }),
    );

    expect(
      screen.getByRole("combobox", { name: "Tìm trong lịch" }),
    ).toHaveFocus();
    expect(screen.getByRole("group", { name: "Lệnh lịch" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Sắp tới" })).toBeInTheDocument();
  });

  it("lọc task và mở panel chi tiết hiện có khi chọn kết quả", () => {
    const callbacks = renderSearch();
    fireEvent.click(
      screen.getByRole("button", { name: "Tìm việc, sự kiện hoặc lệnh lịch" }),
    );

    const input = screen.getByRole("combobox", { name: "Tìm trong lịch" });
    fireEvent.change(input, {
      target: { value: "báo cáo" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(callbacks.onOpenTask).toHaveBeenCalledWith("task-1", expect.any(HTMLElement));
    expect(
      screen.getByRole("button", { name: "Tìm việc, sự kiện hoặc lệnh lịch" }),
    ).toBeInTheDocument();
  });

  it("lọc sự kiện theo tiêu đề và mở đúng thực thể", () => {
    const callbacks = renderSearch();
    fireEvent.click(
      screen.getByRole("button", { name: "Tìm việc, sự kiện hoặc lệnh lịch" }),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Tìm trong lịch" }), {
      target: { value: "kế hoạch tuần" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Họp kế hoạch tuần/ }));

    expect(callbacks.onOpenEvent).toHaveBeenCalledWith(meeting, expect.any(HTMLElement));
  });

  it("chạy lệnh chuyển chế độ và đóng panel", () => {
    const callbacks = renderSearch();
    fireEvent.click(
      screen.getByRole("button", { name: "Tìm việc, sự kiện hoặc lệnh lịch" }),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Tìm trong lịch" }), {
      target: { value: "tháng" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Xem theo tháng" }));

    expect(callbacks.onViewModeChange).toHaveBeenCalledWith("month");
    expect(
      screen.getByRole("button", { name: "Tìm việc, sự kiện hoặc lệnh lịch" }),
    ).toBeInTheDocument();
  });

  it("đóng và xóa truy vấn bằng Escape", () => {
    renderSearch();
    fireEvent.click(
      screen.getByRole("button", { name: "Tìm việc, sự kiện hoặc lệnh lịch" }),
    );
    const input = screen.getByRole("combobox", { name: "Tìm trong lịch" });
    fireEvent.change(input, { target: { value: "báo cáo" } });
    fireEvent.keyDown(input, { key: "Escape" });

    fireEvent.click(
      screen.getByRole("button", { name: "Tìm việc, sự kiện hoặc lệnh lịch" }),
    );
    expect(screen.getByRole("combobox", { name: "Tìm trong lịch" })).toHaveValue("");
  });
});
