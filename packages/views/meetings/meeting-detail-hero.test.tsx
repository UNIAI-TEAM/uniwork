import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingDetailHero } from "./meeting-detail-hero";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
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
    fireEvent.click(within(notice).getByRole("button", { name: "Gia hạn 15 phút" }));
    expect(h.onExtend).toHaveBeenCalledTimes(1);
    fireEvent.click(within(notice).getByRole("button", { name: "Kết thúc họp" }));
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Vào phòng họp" })).not.toBeInTheDocument();
  });

  it("only explains overtime to an attendee", () => {
    renderHero({ status: "IN_PROGRESS", ...windowFromNow(-60 * 60_000) }, { canHost: false, canCancel: false });
    const notice = screen.getByRole("status");
    expect(within(notice).getByText(/chủ trì có thể gia hạn/i)).toBeInTheDocument();
    expect(within(notice).queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the host a new time or a cancel when the window passed unstarted", () => {
    const h = renderHero({ status: "SCHEDULED", ...windowFromNow(-60 * 60_000) });
    const notice = screen.getByRole("status");
    expect(within(notice).getByText(/chưa bắt đầu/i)).toBeInTheDocument();
    expect(within(notice).getByRole("button", { name: "Sửa lịch" })).toBeInTheDocument();
    fireEvent.click(within(notice).getByRole("button", { name: "Hủy cuộc họp" }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Bắt đầu" })).not.toBeInTheDocument();
  });

  it("keeps a cancelled meeting at full contrast and says when it was cancelled", () => {
    renderHero({ status: "CANCELED" }, { canceledAt: "2026-09-20T03:15:00Z" });
    const hero = screen.getByRole("region", { name: "Standup" });
    expect(hero.className).not.toMatch(/opacity-/);
    expect(screen.getByText("Đã hủy")).toHaveAttribute("data-tone", "destructive");
    expect(screen.getByText(/^Đã hủy lúc /)).toBeInTheDocument();
  });

  it("counts waiting join requests without gluing a number onto the label", () => {
    renderHero({}, { pendingJoins: 2 });
    const join = screen.getByRole("button", { name: /Vào phòng họp/ });
    expect(join).not.toHaveTextContent("(2)");
    expect(within(join).getByText("2 đang chờ")).toBeInTheDocument();
  });

  it("names the host once, without a stray icon, and leaves the head count to the roster", () => {
    renderHero({});
    expect(screen.getAllByText("Mai Anh")).toHaveLength(1);
    expect(screen.queryByText(/người tham dự/)).not.toBeInTheDocument();
  });
});
