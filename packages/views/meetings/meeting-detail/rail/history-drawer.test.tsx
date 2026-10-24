import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import type { MeetingActivityItem } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext } from "../detail-context";
import { demo, detailValue } from "../test-fixtures";
import { continuesRun, HistoryDrawer } from "./history-drawer";

const lan = demo.users.lan.id;

function activityRespond(activity: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) => {
    if (String(path).endsWith("/activity")) return activity();
    return Promise.resolve({});
  });
}

function renderDrawer() {
  render(
    wrapWithNav(
      <DetailContext.Provider value={detailValue("m1")}>
        <HistoryDrawer open onOpenChange={() => {}} />
      </DetailContext.Provider>,
    ),
  );
}

const EMPTY = "Chưa có thao tác nào.";

beforeEach(() => {
  requestMock.mockReset();
});

describe("HistoryDrawer (ported from the activity timeline)", () => {
  it("is a 480 drawer named for the history", async () => {
    activityRespond(() => Promise.resolve({ activity: [] }));
    renderDrawer();
    expect(await screen.findByRole("dialog", { name: "Lịch sử thao tác" })).toBeInTheDocument();
  });

  it("shows a loading skeleton, not the empty copy, while activity loads", () => {
    activityRespond(() => new Promise(() => {}));
    renderDrawer();
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when activity fails", async () => {
    activityRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    renderDrawer();
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
          { id: "a1", event_type: "MEETING_STARTED", actor_id: "u-gone", from_state: "SCHEDULED", to_state: "IN_PROGRESS", occurred_at: "2026-09-22T02:00:00Z" },
          { id: "a0", event_type: "PARTICIPANT_INVITED", actor_id: "u-gone", to_state: "01J8X4K2M0N1P2Q3R4S5T6U7V8", occurred_at: "2026-09-22T01:00:00Z" },
        ],
      }),
    );
    renderDrawer();
    expect(await screen.findByText("Đã lên lịch → Đang diễn ra")).toBeInTheDocument();
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
          { id: "v1", event_type: "MOTION_OPENED", actor_id: lan, from_state: "DRAFT", to_state: "OPEN", occurred_at: "2026-09-22T02:30:00Z", payload: { title: "Thông qua kế hoạch quý IV" } },
          { id: "v0", event_type: "ATTENDANCE_FINALIZED", actor_id: lan, occurred_at: "2026-09-22T02:20:00Z" },
        ],
      }),
    );
    renderDrawer();
    expect(await screen.findByText("đã đóng biểu quyết")).toBeInTheDocument();
    expect(screen.getByText("đã mở biểu quyết")).toBeInTheDocument();
    expect(screen.getByText("đã chốt điểm danh")).toBeInTheDocument();
    expect(screen.getByText('"Thông qua kế hoạch quý IV" · Thông qua')).toBeInTheDocument();
    expect(screen.getByText('"Thông qua kế hoạch quý IV"')).toBeInTheDocument();
    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
    expect(screen.queryByText(/PASSED|DRAFT/)).not.toBeInTheDocument();
  });

  it("names a person once for a run of their actions", async () => {
    activityRespond(() =>
      Promise.resolve({
        activity: [
          { id: "b1", event_type: "MOTION_OPENED", actor_id: lan, occurred_at: "2026-09-22T02:30:00Z", payload: { title: "A" } },
          { id: "b0", event_type: "ATTENDANCE_FINALIZED", actor_id: lan, occurred_at: "2026-09-22T02:25:00Z" },
        ],
      }),
    );
    renderDrawer();
    const [first, second] = await screen.findAllByRole("listitem");
    expect(within(first!).getByText("Lan Phạm")).not.toHaveClass("sr-only");
    expect(within(second!).getByText(/Lan Phạm/)).toHaveClass("sr-only");
  });
});

describe("continuesRun", () => {
  const row = (actor_id: string, occurred_at: string) => ({ id: occurred_at, event_type: "X", actor_id, occurred_at }) as MeetingActivityItem;
  it("joins one person's rows ten minutes apart at most, and the system's empty and named ids", () => {
    expect(continuesRun(undefined, row("a", "2026-01-01T00:00:00Z"))).toBe(false);
    expect(continuesRun(row("a", "2026-01-01T00:10:00Z"), row("a", "2026-01-01T00:00:00Z"))).toBe(true);
    expect(continuesRun(row("a", "2026-01-01T00:11:00Z"), row("a", "2026-01-01T00:00:00Z"))).toBe(false);
    expect(continuesRun(row("a", "2026-01-01T00:01:00Z"), row("b", "2026-01-01T00:00:00Z"))).toBe(false);
    expect(continuesRun(row("", "2026-01-01T00:01:00Z"), row("system", "2026-01-01T00:00:00Z"))).toBe(true);
  });
});
