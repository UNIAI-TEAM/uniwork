import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingActivityTimeline } from "./meeting-activity-timeline";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

function activityRespond(activity: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/activity")) return activity();
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    return Promise.resolve({});
  });
}

const EMPTY = "Chưa có thao tác nào.";

function renderTimeline() {
  render(wrapWithNav(<MeetingActivityTimeline workspaceId="w1" meetingId="m1" defaultOpen />));
}

describe("MeetingActivityTimeline", () => {
  it("shows a loading skeleton, not the empty copy, while activity loads", () => {
    activityRespond(() => new Promise(() => {}));
    renderTimeline();

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("shows the empty copy once an empty list arrives", async () => {
    activityRespond(() => Promise.resolve({ activity: [] }));
    renderTimeline();

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when activity fails", async () => {
    activityRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    renderTimeline();

    expect(await screen.findByText("Không tải được lịch sử thao tác.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

    activityRespond(() => Promise.resolve({ activity: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("reads state changes in words, hides provider noise and marks system actions", async () => {
    activityRespond(() =>
      Promise.resolve({
        activity: [
          { id: "a3", event_type: "PROVIDER_ROOM_IDLE_DESYNC", actor_id: "", from_state: "IN_PROGRESS", to_state: "IDLE", occurred_at: "2026-09-22T02:20:00Z" },
          { id: "a2", event_type: "MEETING_ENDED", actor_id: "", from_state: "IN_PROGRESS", to_state: "ENDED", occurred_at: "2026-09-22T02:15:00Z" },
          { id: "a1", event_type: "MEETING_STARTED", actor_id: "u1", from_state: "SCHEDULED", to_state: "IN_PROGRESS", occurred_at: "2026-09-22T02:00:00Z" },
          { id: "a0", event_type: "PARTICIPANT_INVITED", actor_id: "u1", to_state: "01J8X4K2M0N1P2Q3R4S5T6U7V8", occurred_at: "2026-09-22T01:00:00Z" },
        ],
      }),
    );
    renderTimeline();

    // One text node, so the page's lone "Đang diễn ra" badge stays unique.
    expect(await screen.findByText("Đã lên lịch → Đang diễn ra")).toBeInTheDocument();
    expect(screen.queryByText("Đang diễn ra", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Đang diễn ra → Đã kết thúc")).toBeInTheDocument();
    expect(screen.queryByText(/SCHEDULED|IN_PROGRESS|IDLE|01J8X4/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
    expect(screen.getAllByText("Thành viên đã rời").length).toBeGreaterThan(0);
  });
  it("names the vote item and its outcome, and reads an automatic close as the system", async () => {
    activityRespond(() =>
      Promise.resolve({
        activity: [
          {
            id: "v2",
            event_type: "MOTION_CLOSED",
            actor_id: "system",
            from_state: "OPEN",
            to_state: "PASSED",
            occurred_at: "2026-09-22T02:40:00Z",
            payload: { title: "Thông qua kế hoạch quý IV", outcome: "PASSED" },
          },
          {
            id: "v1",
            event_type: "MOTION_OPENED",
            actor_id: "u1",
            from_state: "DRAFT",
            to_state: "OPEN",
            occurred_at: "2026-09-22T02:30:00Z",
            payload: { title: "Thông qua kế hoạch quý IV" },
          },
          { id: "v0", event_type: "ATTENDANCE_FINALIZED", actor_id: "u1", occurred_at: "2026-09-22T02:20:00Z" },
        ],
      }),
    );
    renderTimeline();

    expect(await screen.findByText("đã đóng biểu quyết")).toBeInTheDocument();
    expect(screen.getByText("đã mở biểu quyết")).toBeInTheDocument();
    expect(screen.getByText("đã chốt điểm danh")).toBeInTheDocument();
    expect(screen.getByText("“Thông qua kế hoạch quý IV” · Thông qua")).toBeInTheDocument();
    expect(screen.getByText("“Thông qua kế hoạch quý IV”")).toBeInTheDocument();
    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
    expect(screen.queryByText(/PASSED|DRAFT/)).not.toBeInTheDocument();
  });
});
