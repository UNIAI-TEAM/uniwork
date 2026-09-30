import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingAttendancePanel } from "./meeting-attendance-panel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const meeting = {
  id: "m1", workspace_id: "ws1", title: "Giao ban", description: "", starts_at: "2026-09-30T02:00:00Z",
  ends_at: "2026-09-30T03:00:00Z", room_name: "r", created_by: "u1", status: "IN_PROGRESS",
} as Meeting;
const row = (over: Record<string, unknown>) => ({
  participant_id: "p1", principal_type: "USER", user_id: "u1", display_name: "An", standing: "MEMBER",
  is_secretary: false, status: "PRESENT", source: "SUGGESTED", note: "", present_seconds: 0, session_count: 0, ...over,
});
let attendance: Record<string, unknown>;

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  requestMock.mockReset();
  attendance = {
    quorum_percent: 60,
    summary: { members: 2, present: 1, late: 0, excused: 0, absent: 1, quorum_met: false },
    rows: [
      row({ first_joined_at: "2026-09-30T02:01:00Z", present_seconds: 1800, session_count: 1, in_room: true }),
      row({ participant_id: "p2", display_name: "Bình", status: "ABSENT", source: "MANUAL" }),
      row({ participant_id: "g1", principal_type: "GUEST", display_name: "Khách A", standing: "OBSERVER" }),
    ],
  };
  requestMock.mockImplementation((path: unknown) =>
    Promise.resolve(String(path).endsWith("/attendance") ? attendance : { status: "ok" }),
  );
});

function renderPanel(canEdit: boolean) {
  render(wrapWithNav(<MeetingAttendancePanel meeting={meeting} workspaceId="ws1" canEdit={canEdit} density="room" />));
}

describe("MeetingAttendancePanel", () => {
  it("summarizes members and flags a missing quorum", async () => {
    renderPanel(true);
    expect(await screen.findByText("Có mặt 1 · Muộn 0 · Vắng có phép 0 · Vắng 1 / 2 thành viên")).toBeInTheDocument();
    expect(screen.getByText("Chưa đủ tỉ lệ (cần 60%)")).toBeInTheDocument();
    expect(screen.getByText("Dự thính (1)")).toBeInTheDocument();
  });

  it("resets a manual mark and finalizes", async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "Trả Bình về gợi ý tự động" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/p2", { method: "DELETE" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chốt điểm danh" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/finalize", { method: "POST" }),
    );
  });

  it("marks a status from the picker", async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole("combobox", { name: "Trạng thái điểm danh của Bình" }));
    const late = await screen.findByRole("option", { name: "Đến muộn" });
    // Base UI commits a mouse click only when the press started on the item.
    fireEvent.pointerDown(late, { pointerType: "mouse" });
    fireEvent.click(late);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/p2", {
        method: "PUT",
        body: { status: "LATE", note: undefined },
      }),
    );
  });

  it("asks for a reason when someone is excused", async () => {
    attendance.rows = [row({ status: "EXCUSED", source: "MANUAL", note: "ốm" })];
    renderPanel(true);
    // Each reason field names its person, so a screen reader can tell them apart.
    const reason = (await screen.findByLabelText("Lý do vắng của An")) as HTMLInputElement;
    expect(reason.value).toBe("ốm");
    reason.focus();
    fireEvent.change(reason, { target: { value: "Đi công tác" } });
    // Enter saves as well as leaving the field.
    fireEvent.keyDown(reason, { key: "Enter" });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/p1", {
        method: "PUT",
        body: { status: "EXCUSED", note: "Đi công tác" },
      }),
    );
  });

  it("is read-only without the clerk role and says when and by whom the roll was finalized", async () => {
    attendance.finalized_at = "2026-09-30T02:30:00Z";
    attendance.finalized_by = "u1";
    renderPanel(false);
    const stamp = await screen.findByText(/Đã chốt lúc .* bởi An$/);
    // A roll read days later needs the date, not just the time.
    expect(stamp.textContent).toMatch(/30.09/);
    expect(screen.queryByRole("button", { name: "Chốt điểm danh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getAllByText("Có mặt").length).toBeGreaterThan(0);
  });

  it("offers reopen once finalized", async () => {
    attendance.finalized_at = "2026-09-30T02:30:00Z";
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "Mở lại" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/reopen", { method: "POST" }),
    );
  });

  it("shows the error state instead of an empty roll when the response drifts", async () => {
    attendance = { rows: "nope" };
    renderPanel(true);
    expect(await screen.findByText("Không tải được điểm danh")).toBeInTheDocument();
  });
});
