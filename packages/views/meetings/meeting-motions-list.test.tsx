import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, User } from "@uniwork/core/types";
import type { MeetingMotion } from "@uniwork/core/types/meeting";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingMotionsList } from "./meeting-motions-list";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const me: User = {
  id: "u-host",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const baseMeeting = {
  id: "m1", workspace_id: "w1", title: "Giao ban", description: "", starts_at: "2026-10-01T02:00:00Z",
  ends_at: "2026-10-01T03:00:00Z", room_name: "r", created_by: "u-host", status: "IN_PROGRESS", host_user_id: "u-host",
} as Meeting;
const motion = (over: Partial<MeetingMotion>): MeetingMotion => ({
  id: "mo1",
  title: "Thông qua kế hoạch",
  description: "",
  position: 1,
  ballot_mode: "PUBLIC",
  threshold: "MAJORITY",
  base: "PRESENT",
  status: "DRAFT",
  roll_size: null,
  total_members: null,
  cast_count: 0,
  result: null,
  voters: null,
  my_ballot: { on_roll: false, cast: false, choice: null },
  ...over,
});

let motions: unknown;
let role: string;

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  setSessionUser(me);
  vi.mocked(toast.success).mockClear();
  motions = [];
  role = "owner";
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u-host", role, source: "membership" } });
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/participants")) return Promise.resolve({ participants: [] });
    if (p.endsWith("/motions") && (opts?.method ?? "GET") === "GET") return Promise.resolve({ motions });
    return Promise.resolve({ status: "ok" });
  });
});

function renderList(meeting: Meeting = baseMeeting) {
  render(
    wrapWithNav(<MeetingMotionsList meeting={meeting} meetingId="m1" workspaceId="w1" canVote={false} density="compact" />),
  );
}

describe("MeetingMotionsList", () => {
  it("lets a clerk add an item before the meeting", async () => {
    renderList({ ...baseMeeting, status: "SCHEDULED" });
    expect(
      await screen.findByText("Chưa có nội dung biểu quyết. Soạn trước, mở từng nội dung khi đang họp."),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Thêm nội dung" }));
    expect(await screen.findByRole("dialog", { name: "Thêm nội dung biểu quyết" })).toBeInTheDocument();
  });

  it("asks before deleting a draft, then deletes it", async () => {
    motions = [motion({})];
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với “Thông qua kế hoạch”" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Xóa" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("“Thông qua kế hoạch” sẽ bị xóa khỏi danh sách biểu quyết.")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith(
      "/api/v1/meetings/m1/motions/mo1",
      expect.objectContaining({ method: "DELETE" }),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/meetings/m1/motions/mo1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã xóa nội dung biểu quyết"));
  });

  it("says how many have not voted before closing", async () => {
    motions = [motion({ status: "OPEN", roll_size: 3, cast_count: 1, opened_at: "2026-10-01T02:10:00Z" })];
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Đóng biểu quyết" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Còn 2 người chưa bỏ phiếu — tính là không tán thành\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Kết quả được kiểm ngay và không thay đổi được nữa\./)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Đóng biểu quyết" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/meetings/m1/motions/mo1/close",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã đóng biểu quyết"));
  });

  it("moves a draft into the next draft's slot", async () => {
    motions = [motion({}), motion({ id: "mo2", title: "Bầu thư ký", position: 2 })];
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với “Thông qua kế hoạch”" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Chuyển xuống" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/meetings/m1/motions/mo1",
        expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ position: 2 }) }),
      ),
    );
  });

  it("keeps the items on screen when a refetch is refused mid-vote", async () => {
    // A ballot_cast refetch can be rate limited (429) while a vote is running;
    // the clerk must keep the open item and its close button, not an error card.
    motions = [motion({ status: "OPEN", roll_size: 3, cast_count: 1, opened_at: "2026-10-01T02:10:00Z" })];
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Đóng biểu quyết" }));
    const dialog = await screen.findByRole("alertdialog");
    let refused = 0;
    requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/motions") && (opts?.method ?? "GET") === "GET") {
        refused += 1;
        return Promise.reject(Object.assign(new Error("too many requests"), { status: 429, code: "rate_limited" }));
      }
      if (p.endsWith("/close")) return Promise.reject(Object.assign(new Error("nope"), { status: 409, code: "x" }));
      return Promise.resolve({ status: "ok" });
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Đóng biểu quyết" }));
    await waitFor(() => expect(refused).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("Không tải được biểu quyết")).not.toBeInTheDocument();
    expect(screen.getByText("Thông qua kế hoạch")).toBeInTheDocument();
  });

  it("shows the error state instead of an empty list when the response drifts", async () => {
    motions = "nope";
    renderList();
    expect(await screen.findByText("Không tải được biểu quyết")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("gives someone who does not clerk the plain empty line and no add button", async () => {
    role = "member";
    renderList({ ...baseMeeting, host_user_id: "u-other" });
    expect(await screen.findByText("Chưa có nội dung biểu quyết.")).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("button", { name: "Thêm nội dung" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Soạn trước/)).not.toBeInTheDocument();
  });
});
