import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { formatMeetingTimes } from "./meeting-datetime";
import { MeetingDetailHero } from "./meeting-detail-hero";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

function windowFromNow(startOffsetMs: number, durationMs = 30 * 60_000) {
  const start = Date.now() + startOffsetMs;
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(start + durationMs).toISOString() };
}

const base: Meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  description: "",
  room_name: "r",
  created_by: "u-host",
  host_user_id: "u-host",
  status: "SCHEDULED",
  ...windowFromNow(60 * 60_000),
};

function renderHero(meeting: Partial<Meeting>, props: Partial<Parameters<typeof MeetingDetailHero>[0]> = {}) {
  const handlers = {
    onStart: vi.fn(),
    onJoin: vi.fn(),
    onExtend: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    wrapWithNav(
      <MeetingDetailHero
        workspaceId="w1"
        meeting={{ ...base, ...meeting }}
        host={{ name: "Mai Anh" }}
        people={[
          { id: "p1", name: "Mai Anh" },
          { id: "p2", name: "Quốc Bảo" },
        ]}
        canHost
        canCancel
        pendingJoins={0}
        startPending={false}
        extendPending={false}
        {...handlers}
        {...props}
      />,
    ),
  );
  return handlers;
}

describe("MeetingDetailHero", () => {
  it("offers the host an extension or an end when a live meeting runs past its window", () => {
    const h = renderHero({ status: "IN_PROGRESS", ...windowFromNow(-60 * 60_000) });
    const notice = screen.getByRole("status");
    expect(within(notice).getByText(/đã qua khung giờ/i)).toBeInTheDocument();
    expect(screen.queryByText(/Không thể vào phòng hoặc bắt đầu/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gia hạn 15 phút" }));
    expect(h.onExtend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Kết thúc họp" }));
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Vào phòng họp" })).not.toBeInTheDocument();
  });

  it("only explains overtime to an attendee", () => {
    renderHero({ status: "IN_PROGRESS", ...windowFromNow(-60 * 60_000) }, { canHost: false, canCancel: false });
    const notice = screen.getByRole("status");
    expect(within(notice).getByText(/chủ trì có thể gia hạn/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gia hạn 15 phút" })).not.toBeInTheDocument();
    expect(within(notice).queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the host a new time or a cancel when the window passed unstarted", () => {
    const h = renderHero({ status: "SCHEDULED", ...windowFromNow(-60 * 60_000) });
    const notice = screen.getByRole("status");
    expect(within(notice).getByText(/chưa mở phòng/i)).toBeInTheDocument();
    // Its own row under the notice, so a phone wraps the three instead of overflowing.
    expect(within(notice).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghi nhận đã họp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sửa lịch" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy cuộc họp" }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Bắt đầu" })).not.toBeInTheDocument();
  });

  it("names the next step once the meeting has ended", () => {
    const onGo = vi.fn();
    renderHero({ status: "ENDED", ...windowFromNow(-2 * 60 * 60_000) }, { nextStep: { kind: "assign", pending: 3, onGo } });
    expect(screen.getByText("3 việc đang chờ giao.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Giao việc" }));
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it("offers the minutes as the next step when nothing waits to be assigned", () => {
    renderHero({ status: "ENDED", ...windowFromNow(-2 * 60 * 60_000) }, { nextStep: { kind: "minutes", onGo: vi.fn() } });
    expect(screen.getByRole("button", { name: "Lập biên bản" })).toBeInTheDocument();
  });

  it("keeps a cancelled meeting at full contrast and says when it was cancelled", () => {
    renderHero({ status: "CANCELED" }, { canceledAt: "2026-09-20T03:15:00Z" });
    const hero = screen.getByRole("region", { name: "Standup" });
    expect(hero.className).not.toMatch(/opacity-/);
    expect(screen.getByText("Đã hủy")).toHaveAttribute("data-tone", "destructive");
    // The badge says it was cancelled; the line beside it only says when.
    expect(screen.getAllByText(/Đã hủy/)).toHaveLength(1);
  });

  it("counts waiting join requests without gluing a number onto the label", () => {
    renderHero({}, { pendingJoins: 2 });
    const join = screen.getByRole("button", { name: /Vào phòng họp/ });
    expect(join).not.toHaveTextContent("(2)");
    expect(within(join).getByText("2 đang chờ")).toBeInTheDocument();
  });

  it("names the host once, without a stray icon, and leaves the visible head count to the roster", () => {
    renderHero({});
    expect(screen.getAllByText("Mai Anh")).toHaveLength(1);
    // The avatar stack is decorative; only screen readers hear the count.
    expect(screen.getByText("2 người tham dự")).toHaveClass("sr-only");
  });

  it("hides the +N overflow from screen readers and keeps the count", () => {
    const people = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Người ${i}` }));
    renderHero({}, { people });
    expect(screen.getByText("6 người tham dự")).toHaveClass("sr-only");
    expect(screen.getByText("+2").closest("[aria-hidden]")).not.toBeNull();
  });

  it("names the hero region by its heading and lets a long title wrap", () => {
    renderHero({ title: "A".repeat(120) });
    const heading = screen.getByRole("heading", { level: 1 });
    expect(screen.getByRole("region", { name: "A".repeat(120) })).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading.className).toMatch(/overflow-wrap:anywhere/);
  });

  it("moves from live to overtime when the window passes, without a reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T09:00:00Z"));
    renderHero({
      status: "IN_PROGRESS",
      starts_at: "2026-09-22T08:30:00Z",
      ends_at: "2026-09-22T09:01:00Z",
    });
    expect(screen.getByRole("button", { name: "Vào phòng họp" })).toBeInTheDocument();
    expect(screen.queryByText(/đã qua khung giờ/i)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.queryByRole("button", { name: "Vào phòng họp" })).not.toBeInTheDocument();
    expect(screen.getByText(/đã qua khung giờ/i)).toBeInTheDocument();
  });

  it("reads an ended meeting by when it actually ran, not the window it was given", () => {
    const now = Date.now();
    const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();
    renderHero({
      status: "ENDED",
      meeting_type: "INSTANT",
      starts_at: iso(-10),
      ends_at: iso(50),
      actual_start_at: iso(-10),
      actual_end_at: iso(-8),
    });
    const actual = formatMeetingTimes(iso(-10), iso(-8), "vi-VN");
    expect(screen.getByText(actual)).toBeInTheDocument();
    expect(screen.queryByText(formatMeetingTimes(iso(-10), iso(50), "vi-VN"))).not.toBeInTheDocument();
    expect(screen.getByText(/2 phút/)).toBeInTheDocument();
    expect(screen.queryByText(/1 giờ/)).not.toBeInTheDocument();
  });

  it("keeps the scheduled window for an ended meeting that never recorded its run", () => {
    const window = windowFromNow(-2 * 60 * 60_000);
    renderHero({ status: "ENDED", ...window });
    expect(screen.getByText(formatMeetingTimes(window.starts_at, window.ends_at, "vi-VN"))).toBeInTheDocument();
    expect(screen.getByText(/30 phút/)).toBeInTheDocument();
  });

  it("names both clocks when the meeting was set in another zone", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const other = zone === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";
    renderHero({ timezone: other, starts_at: "2026-09-22T00:00:00Z", ends_at: "2026-09-22T00:30:00Z" });
    const city = other === "Asia/Tokyo" ? "Tokyo" : "New York";
    expect(screen.getByText(new RegExp(`\\(GMT[+-]\\d+ · ${city}\\)`))).toBeInTheDocument();
  });

  it("does not repeat the clock when the meeting zone is the viewer's", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    renderHero({ timezone: zone });
    expect(screen.queryByText(/\(GMT/)).not.toBeInTheDocument();
  });

  it("uses the solid destructive fill for ending an overtime meeting", () => {
    renderHero({ status: "IN_PROGRESS", ...windowFromNow(-60 * 60_000) });
    expect(screen.getByRole("button", { name: "Kết thúc họp" })).toHaveClass("bg-destructive-solid");
  });

  it("says only when an ended meeting ended: the badge already says it did", () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    renderHero({ status: "ENDED", starts_at: iso(-40 * 60_000), ends_at: iso(-6 * 60_000) });
    expect(screen.getByText("6 phút trước")).toBeInTheDocument();
    expect(screen.queryByText(/^Kết thúc /)).not.toBeInTheDocument();
  });

  it("reads under a minute as \"vừa xong\", never Intl's \"bây giờ\" that sounds like an order", () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    renderHero({ status: "ENDED", starts_at: iso(-30 * 60_000), ends_at: iso(-20_000) });
    expect(screen.getByText("vừa xong")).toBeInTheDocument();
    expect(screen.queryByText(/bây giờ/)).not.toBeInTheDocument();
  });

  it("words the minute around a start, never \"Bắt đầu bây giờ\"", () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    renderHero({ starts_at: iso(20_000), ends_at: iso(30 * 60_000) });
    expect(screen.getByText("Sắp bắt đầu")).toBeInTheDocument();
    expect(screen.queryByText(/bây giờ/)).not.toBeInTheDocument();
  });

  it("says a meeting that started under a minute ago just started", () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    renderHero({ status: "IN_PROGRESS", starts_at: iso(-20_000), ends_at: iso(30 * 60_000), actual_start_at: iso(-20_000) });
    expect(screen.getByText("Vừa bắt đầu")).toBeInTheDocument();
    expect(screen.queryByText(/bây giờ/)).not.toBeInTheDocument();
  });

  describe("on a pinned clock", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 22, 9, 0));
    });
    const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();

    it("tells a cancel on the meeting's own day by its clock alone", () => {
      renderHero({ status: "CANCELED", starts_at: at(2026, 10, 23, 14, 0), ends_at: at(2026, 10, 23, 15, 0) }, {
        canceledAt: at(2026, 10, 23, 8, 5),
      });
      expect(screen.getByText("08:05")).toBeInTheDocument();
    });

    it("names the day of a cancel on another one, in the hero's style", () => {
      renderHero({ status: "CANCELED", starts_at: at(2026, 10, 23, 14, 0), ends_at: at(2026, 10, 23, 15, 0) }, {
        canceledAt: at(2026, 10, 21, 16, 59),
      });
      expect(screen.getByText("Thứ Tư, 21 tháng 10, 16:59")).toBeInTheDocument();
    });

    it("says an overtime window's end by its clock on the same day", () => {
      renderHero({ status: "IN_PROGRESS", starts_at: at(2026, 10, 22, 8, 0), ends_at: at(2026, 10, 22, 8, 30) });
      expect(screen.getByText(/đã qua khung giờ lúc 08:30 nên/)).toBeInTheDocument();
    });

    it("marks a window that runs past midnight as ending the next day", () => {
      renderHero({ starts_at: at(2026, 10, 23, 23, 30), ends_at: at(2026, 10, 24, 0, 30) });
      expect(screen.getByText("23:30 – 00:30 (hôm sau)")).toBeInTheDocument();
      expect(screen.getByText("Thứ Sáu, 23 tháng 10")).toBeInTheDocument();
    });

    it("names the year of a meeting from another year", () => {
      renderHero({ status: "ENDED", starts_at: at(2025, 10, 21, 9, 0), ends_at: at(2025, 10, 21, 10, 0) });
      expect(screen.getByText("Thứ Ba, 21 tháng 10, 2025")).toBeInTheDocument();
    });

    it("lets the other zone's line wrap on a phone instead of cutting it", () => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const other = zone === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";
      renderHero({ timezone: other, starts_at: at(2026, 10, 23, 9, 0), ends_at: at(2026, 10, 23, 9, 30) });
      const line = screen.getAllByText(/\(GMT[+-]\d+ · /).at(-1)!.closest("span.min-w-0")!;
      expect(line.className).not.toMatch(/truncate/);
      expect(line.className).toMatch(/overflow-wrap:anywhere/);
    });
  });
});
