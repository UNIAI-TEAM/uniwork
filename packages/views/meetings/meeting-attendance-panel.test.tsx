import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { toast } from "sonner";
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
  vi.mocked(toast.error).mockReset();
  attendance = {
    quorum_percent: 60,
    summary: { members: 2, present: 1, late: 0, excused: 0, absent: 1, quorum_met: false },
    rows: [
      row({ first_joined_at: "2026-09-30T02:01:00Z", present_seconds: 1800, session_count: 1, in_room: true }),
      row({ participant_id: "p2", user_id: "u2", display_name: "Bình", status: "ABSENT", source: "MANUAL" }),
      row({ participant_id: "g1", principal_type: "GUEST", user_id: undefined, display_name: "Khách A", standing: "OBSERVER" }),
    ],
  };
  requestMock.mockImplementation((path: unknown) =>
    Promise.resolve(String(path).endsWith("/attendance") ? attendance : { status: "ok" }),
  );
});

function renderPanel(canEdit: boolean, query?: string) {
  render(
    wrapWithNav(
      <MeetingAttendancePanel meeting={meeting} workspaceId="ws1" canEdit={canEdit} density="room" query={query} />,
    ),
  );
}

describe("MeetingAttendancePanel", () => {
  it("says the roll is open and how many members the quorum still needs", async () => {
    renderPanel(true);
    expect(await screen.findByText(/^Chưa chốt\. Dòng “Tự động” lấy theo lượt vào phòng/)).toBeInTheDocument();
    expect(screen.getByText("Có mặt 1/2 · 50%")).toBeInTheDocument();
    // 60% of 2 members is 1.2, so two must attend.
    expect(screen.getByText("Chưa đủ tỉ lệ: cần 60%, còn thiếu 1 người")).toBeInTheDocument();
    expect(screen.getByText("Dự thính (1)")).toBeInTheDocument();
  });

  it("resets a manual mark, and finalizes only after confirming", async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "Trả Bình về gợi ý tự động" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/p2", { method: "DELETE" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chốt điểm danh" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Danh sách sẽ bị khóa. Muốn sửa phải mở lại.")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/finalize", { method: "POST" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Chốt điểm danh" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/finalize", { method: "POST" }),
    );
  });

  it("keeps keyboard focus on the footer when finalizing swaps its button", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/finalize")) attendance.finalized_at = "2026-09-30T02:30:00Z";
      return Promise.resolve(p.endsWith("/attendance") ? attendance : { status: "ok" });
    });
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "Chốt điểm danh" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Chốt điểm danh" }));
    const reopen = await screen.findByRole("button", { name: "Mở lại" });
    await waitFor(() => expect(reopen).toHaveFocus());
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

  it("puts a refused mark back and says so", async () => {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      init?.method === "PUT"
        ? Promise.reject(new Error("refused"))
        : Promise.resolve(String(path).endsWith("/attendance") ? attendance : { status: "ok" }),
    );
    renderPanel(true);
    const picker = await screen.findByRole("combobox", { name: "Trạng thái điểm danh của Bình" });
    fireEvent.click(picker);
    const present = await screen.findByRole("option", { name: "Có mặt" });
    fireEvent.pointerDown(present, { pointerType: "mouse" });
    fireEvent.click(present);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(picker).toHaveTextContent("Vắng"));
  });

  it("takes the clerk to the reason field after picking excused", async () => {
    // The server keeps the mark, so the refetch after it agrees with the optimistic row.
    requestMock.mockImplementation((path: unknown, init?: { method?: string; body?: { status: string } }) => {
      const p = String(path);
      if (init?.method === "PUT") {
        attendance.rows = (attendance.rows as Record<string, unknown>[]).map((r) =>
          p.endsWith(`/${String(r.participant_id)}`) ? { ...r, status: init.body?.status, source: "MANUAL" } : r,
        );
      }
      return Promise.resolve(p.endsWith("/attendance") ? attendance : { status: "ok" });
    });
    renderPanel(true);
    fireEvent.click(await screen.findByRole("combobox", { name: "Trạng thái điểm danh của Bình" }));
    const excused = await screen.findByRole("option", { name: "Vắng có phép" });
    fireEvent.pointerDown(excused, { pointerType: "mouse" });
    fireEvent.click(excused);
    const reason = await screen.findByLabelText("Lý do vắng của Bình");
    await waitFor(() => expect(reason).toHaveFocus());
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
    // The save is confirmed where the clerk is looking.
    expect(await screen.findByText("Đã lưu")).toBeInTheDocument();
  });

  it("is read-only without the clerk role, shows reasons, and says when and by whom the roll was finalized", async () => {
    attendance.finalized_at = "2026-09-30T02:30:00Z";
    attendance.finalized_by = "u1";
    attendance.rows = [...(attendance.rows as unknown[]), row({ participant_id: "p3", display_name: "Chi", status: "EXCUSED", note: "ốm" })];
    renderPanel(false);
    const stamp = await screen.findByText(/^Đã chốt lúc .* bởi An\.$/);
    // A roll read days later needs the date, not just the time.
    expect(stamp.textContent).toMatch(/30\/9/);
    expect(screen.queryByRole("button", { name: "Chốt điểm danh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Lý do: ốm")).toBeInTheDocument();
  });

  it("tells a reader the figures are not final yet", async () => {
    renderPanel(false);
    expect(await screen.findByText("Chưa chốt — số liệu còn có thể thay đổi.")).toBeInTheDocument();
  });

  it("locks a finalized roll for the clerk until it is reopened", async () => {
    attendance.finalized_at = "2026-09-30T02:30:00Z";
    renderPanel(true);
    expect(await screen.findByText(/Mở lại để sửa\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /về gợi ý tự động/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở lại" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mở lại" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/reopen", { method: "POST" }),
    );
  });

  it("keeps people added after finalizing apart and marks those removed since", async () => {
    attendance.finalized_at = "2026-09-30T02:30:00Z";
    attendance.summary = { members: 2, present: 1, late: 0, excused: 0, absent: 1, quorum_met: false };
    attendance.rows = [
      row({ source: "MANUAL" }),
      row({ participant_id: "p2", user_id: "u2", display_name: "Bình", status: "ABSENT", source: "MANUAL", removed: true }),
      row({ participant_id: "p4", user_id: "u4", display_name: "Dũng", source: "SUGGESTED", joined_after_finalize: true }),
    ];
    renderPanel(true);
    const later = await screen.findByRole("region", { name: "Thêm sau khi chốt (1)" });
    expect(within(later).getByText("Dũng")).toBeInTheDocument();
    expect(within(later).getByText("Chưa được tính vào số liệu đã chốt. Mở lại điểm danh để tính.")).toBeInTheDocument();
    // The snapshot's own figures, not recounted with the newcomer.
    expect(screen.getByText("Có mặt 1/2 · 50%")).toBeInTheDocument();
    const binh = screen.getByText("Bình").closest("li")!;
    expect(within(binh).getByText("Đã gỡ")).toBeInTheDocument();
    expect(screen.getAllByText("Đã gỡ")).toHaveLength(1);
  });

  it("shows nobody apart while the roll is open", async () => {
    attendance.rows = [...(attendance.rows as unknown[]), row({ participant_id: "p4", display_name: "Dũng", joined_after_finalize: true })];
    renderPanel(true);
    await screen.findByText("Dũng");
    expect(screen.queryByRole("region", { name: /Thêm sau khi chốt/ })).not.toBeInTheDocument();
  });

  it("narrows the roll by name and opens the observers when they match", async () => {
    renderPanel(true, "khách");
    expect(await screen.findByText("Khách A")).toBeVisible();
    expect(screen.queryByText("Bình")).not.toBeInTheDocument();
  });

  it("shows the error state instead of an empty roll when the response drifts", async () => {
    attendance = { rows: "nope" };
    renderPanel(true);
    expect(await screen.findByText("Không tải được điểm danh")).toBeInTheDocument();
  });
});
