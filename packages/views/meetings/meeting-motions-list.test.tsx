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
  ...over,
});

let motions: unknown;
let ballots: unknown;
let role: string;

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  setSessionUser(me);
  vi.mocked(toast.success).mockClear();
  motions = [];
  ballots = [];
  role = "owner";
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u-host", role, source: "membership" } });
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/participants")) return Promise.resolve({ participants: [] });
    if (p.endsWith("/motions") && (opts?.method ?? "GET") === "GET") return Promise.resolve({ motions });
    if (p.endsWith("/my-ballots")) return Promise.resolve({ ballots });
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
    fireEvent.click(await screen.findByRole("button", { name: 'Thao tác với "Thông qua kế hoạch"' }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Xóa" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('"Thông qua kế hoạch" sẽ bị xóa khỏi danh sách biểu quyết.')).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: 'Thao tác với "Thông qua kế hoạch"' }));
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

describe("MeetingMotionsList — room", () => {
  const BALLOT = "/api/v1/meetings/m1/motions/mo1/ballot";
  const open = (over: Partial<MeetingMotion> = {}) =>
    motion({
      status: "OPEN",
      roll_size: 3,
      cast_count: 2,
      opened_at: "2026-10-01T02:10:00Z",
      ...over,
    });
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

  function renderRoom(meeting: Meeting = baseMeeting) {
    // On the roll, not yet voted, unless a test says otherwise.
    if (Array.isArray(ballots) && ballots.length === 0) ballots = [{ motion_id: "mo1", cast: false }];
    render(wrapWithNav(<MeetingMotionsList meeting={meeting} meetingId="m1" workspaceId="w1" canVote density="room" />));
  }

  it("reads 'Kín' on a secret ballot's chip and names it in full", async () => {
    motions = [open({ ballot_mode: "SECRET" })];
    renderRoom();
    await screen.findByRole("button", { name: "Gửi phiếu" });
    expect(screen.getByText("Kín")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Bỏ phiếu kín")).toHaveClass("sr-only");
  });

  it("sends a ballot only once a choice is picked", async () => {
    motions = [open()];
    renderRoom();
    const submit = await screen.findByRole("button", { name: "Gửi phiếu" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Đang bỏ phiếu")).toBeInTheDocument();
    expect(screen.getByText("2/3 đã bỏ phiếu")).toBeInTheDocument();
    expect(screen.getByText("Công khai")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cách tính phiếu" })).toBeInTheDocument();
    fireEvent.click(submit);
    expect(requestMock).not.toHaveBeenCalledWith(BALLOT, expect.anything());

    fireEvent.click(screen.getByRole("radio", { name: "Tán thành" }));
    expect(submit).not.toHaveAttribute("aria-disabled");
    fireEvent.click(submit);
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(BALLOT, { method: "POST", body: { choice: "YES" } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã ghi nhận phiếu"));
  });

  it("shows the voter what they chose once the ballot is in", async () => {
    motions = [open()];
    ballots = [{ motion_id: "mo1", cast: true, choice: "YES" }];
    renderRoom();
    expect(await screen.findByText("Bạn đã chọn: Tán thành")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gửi phiếu" })).not.toBeInTheDocument();
  });

  it("gives the clerk who is missing and the close button, and an attendee neither", async () => {
    motions = [open()];
    renderRoom();
    expect(await screen.findByText("Còn 1 người chưa bỏ phiếu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng biểu quyết" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Còn 1 người chưa bỏ phiếu — tính là không tán thành\./)).toBeInTheDocument();
  });

  it("keeps the clerk's line and close button from an attendee", async () => {
    role = "member";
    motions = [open()];
    renderRoom({ ...baseMeeting, host_user_id: "u-other" });
    expect(await screen.findByRole("button", { name: "Gửi phiếu" })).toBeInTheDocument();
    await settle();
    expect(screen.queryByText("Còn 1 người chưa bỏ phiếu")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đóng biểu quyết" })).not.toBeInTheDocument();
  });

  it("puts the open vote first, then drafts, then results with their tallies as one labelled bar", async () => {
    motions = [
      motion({
        id: "mo3",
        title: "Lùi ngày ra mắt",
        status: "CLOSED",
        roll_size: 8,
        cast_count: 8,
        result: { yes: 6, no: 1, abstain: 1, required: 5, outcome: "PASSED" },
      }),
      motion({ id: "mo2", title: "Chọn hình thức đào tạo", position: 2 }),
      open(),
    ];
    renderRoom();
    const bar = await screen.findByRole("img", {
      name: "6 tán thành, 1 không tán thành, 1 không ý kiến. Cần 5/8 phiếu tán thành",
    });
    expect(screen.getByText("Thông qua")).toBeInTheDocument();
    const order = ["Thông qua kế hoạch", "Tiếp theo", "Chọn hình thức đào tạo", "Đã xong", "Lùi ngày ra mắt"].map((text) =>
      screen.getByText(text),
    );
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(order[4]!.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One vote runs at a time: the draft's open button waits and says why.
    const openDraft = await screen.findByRole("button", { name: "Mở biểu quyết: Chọn hình thức đào tạo" });
    expect(openDraft).toHaveTextContent(/^Mở$/);
    expect(openDraft).toHaveAttribute("aria-disabled", "true");
    expect(openDraft).toHaveAttribute("title", "Đang có nội dung khác mở biểu quyết.");
    expect(openDraft).toHaveAccessibleDescription("Đang có nội dung khác mở biểu quyết.");
  });

  it("says there were no voters instead of drawing an empty bar", async () => {
    motions = [
      motion({
        status: "CLOSED",
        roll_size: 0,
        cast_count: 0,
        result: { yes: 0, no: 0, abstain: 0, required: 0, outcome: "FAILED" },
      }),
    ];
    renderRoom();
    expect(await screen.findByText("Không có cử tri")).toBeInTheDocument();
    expect(screen.getByText("Không thông qua")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("moves focus to the confirmation when the ballot it was in gives way to it", async () => {
    motions = [open()];
    renderRoom();
    fireEvent.click(await screen.findByRole("radio", { name: "Tán thành" }));
    const submit = screen.getByRole("button", { name: "Gửi phiếu" });
    submit.focus();
    // The refetch after casting reports the ballot in.
    ballots = [{ motion_id: "mo1", cast: true, choice: "YES" }];
    fireEvent.click(submit);
    const done = await screen.findByText("Bạn đã chọn: Tán thành");
    await waitFor(() => expect(done).toHaveFocus());
  });

  it("leaves focus alone when the ballot is replaced while focus is elsewhere", async () => {
    motions = [open()];
    ballots = [{ motion_id: "mo1", cast: false }];
    renderRoom();
    await screen.findByRole("button", { name: "Gửi phiếu" });
    const help = screen.getByRole("button", { name: "Cách tính phiếu" });
    help.focus();
    ballots = [{ motion_id: "mo1", cast: true, choice: "NO" }];
    fireEvent.click(screen.getByRole("radio", { name: "Không tán thành" }));
    help.focus();
    fireEvent.click(screen.getByRole("button", { name: "Gửi phiếu" }));
    const done = await screen.findByText("Bạn đã chọn: Không tán thành");
    expect(done).not.toHaveFocus();
    expect(help).toHaveFocus();
  });
});
