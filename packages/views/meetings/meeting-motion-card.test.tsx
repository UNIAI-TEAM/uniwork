import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingMotion } from "@uniwork/core/types/meeting";
import { toast } from "sonner";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingMotionBallot } from "./meeting-motion-ballot";
import { MeetingMotionCard } from "./meeting-motion-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const motion = (over: Partial<MeetingMotion> = {}): MeetingMotion => ({
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
const handlers = {
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onMove: vi.fn(),
  onOpen: vi.fn(),
  onClose: vi.fn(),
};
const BALLOT = "/api/v1/meetings/m1/motions/mo1/ballot";

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ status: "ok" });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  for (const fn of Object.values(handlers)) fn.mockReset();
});

function renderCard(m: MeetingMotion, over: Partial<ComponentProps<typeof MeetingMotionCard>> = {}) {
  return render(
    wrapWithNav(
      <MeetingMotionCard
        meetingId="m1"
        motion={m}
        isClerk={false}
        canVote={false}
        inProgress
        anotherOpen={false}
        canMoveUp
        canMoveDown
        {...handlers}
        {...over}
      />,
    ),
  );
}

describe("MeetingMotionCard — draft", () => {
  it("shows the settings and keeps opening blocked until the meeting runs", () => {
    renderCard(motion({ description: "Chi tiết kế hoạch" }), { isClerk: true, inProgress: false });
    expect(screen.getByText("Nháp")).toBeInTheDocument();
    expect(screen.getByText("Công khai")).toBeInTheDocument();
    expect(screen.getByText("Quá bán")).toBeInTheDocument();
    expect(screen.getByText("Trên số tham dự")).toBeInTheDocument();
    expect(screen.getByText("Chi tiết kế hoạch")).toBeInTheDocument();
    const open = screen.getByRole("button", { name: "Mở biểu quyết" });
    // aria-disabled, not disabled: the button stays in the tab order and names its reason.
    expect(open).toHaveAttribute("aria-disabled", "true");
    expect(open).toHaveAccessibleDescription("Mở được khi cuộc họp đang diễn ra.");
    fireEvent.click(open);
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("waits for the other open item, then opens", () => {
    const { unmount } = renderCard(motion(), { isClerk: true, anotherOpen: true });
    const waiting = screen.getByRole("button", { name: "Mở biểu quyết" });
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(waiting).toHaveAccessibleDescription("Đang có nội dung khác mở biểu quyết.");
    unmount();
    renderCard(motion(), { isClerk: true });
    const open = screen.getByRole("button", { name: "Mở biểu quyết" });
    expect(open).not.toHaveAttribute("aria-disabled");
    fireEvent.click(open);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
  });

  it("edits, reorders and deletes from the actions menu", async () => {
    renderCard(motion(), { isClerk: true, canMoveUp: false });
    const menu = screen.getByRole("button", { name: "Thao tác với “Thông qua kế hoạch”" });
    fireEvent.click(menu);
    expect(await screen.findByRole("menuitem", { name: "Chuyển lên" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Chuyển xuống" }));
    expect(handlers.onMove).toHaveBeenCalledWith("down");
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sửa" }));
    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Xóa" }));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it("offers no clerk actions to anyone else", () => {
    renderCard(motion());
    expect(screen.queryByRole("button", { name: "Mở biểu quyết" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Thao tác với/ })).not.toBeInTheDocument();
  });
});

describe("MeetingMotionCard — open", () => {
  const open = (over: Partial<MeetingMotion> = {}) =>
    motion({
      status: "OPEN",
      roll_size: 4,
      total_members: 5,
      cast_count: 1,
      my_ballot: { on_roll: true, cast: false, choice: null },
      ...over,
    });

  it("shows progress and a two-step ballot that submits only after a choice", async () => {
    renderCard(open(), { canVote: true });
    expect(screen.getByText("Đang bỏ phiếu")).toBeInTheDocument();
    expect(screen.getByText("Đã bỏ phiếu 1/4")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Phiếu của bạn cho “Thông qua kế hoạch”" })).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Gửi phiếu" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(requestMock).not.toHaveBeenCalledWith(BALLOT, expect.anything());

    fireEvent.click(screen.getByRole("radio", { name: "Tán thành" }));
    expect(submit).not.toHaveAttribute("aria-disabled");
    fireEvent.click(submit);
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(BALLOT, { method: "POST", body: { choice: "YES" } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã ghi nhận phiếu"));
  });

  it("tells someone off the roll that they cannot vote", () => {
    renderCard(open({ my_ballot: { on_roll: false, cast: false, choice: null } }), { canVote: true });
    expect(screen.getByText("Bạn không thuộc danh sách bỏ phiếu của nội dung này.")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("shows an open-ballot vote back to its voter, and only that a secret one was cast", () => {
    const { unmount } = renderCard(open({ my_ballot: { on_roll: true, cast: true, choice: "NO" } }), { canVote: true });
    expect(screen.getByText("Bạn đã chọn: Không tán thành")).toBeInTheDocument();
    unmount();
    renderCard(open({ ballot_mode: "SECRET", my_ballot: { on_roll: true, cast: true, choice: null } }), { canVote: true });
    expect(screen.getByText("Bạn đã bỏ phiếu")).toBeInTheDocument();
  });

  it("sends voters to the room from the detail page and lets the clerk close", () => {
    renderCard(open(), { isClerk: true });
    expect(screen.getByText("Bỏ phiếu trong phòng họp.")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng biểu quyết" }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("MeetingMotionBallot", () => {
  it("treats a repeat submit the server refuses as already_voted as recorded", async () => {
    requestMock.mockRejectedValue(new ApiError("bạn đã bỏ phiếu cho nội dung này", "already_voted", 409));
    const onCast = vi.fn();
    render(
      wrapWithNav(
        <MeetingMotionBallot meetingId="m1" motion={motion({ status: "OPEN" })} compact onCast={onCast} />,
      ),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Không ý kiến" }));
    fireEvent.click(screen.getByRole("button", { name: "Gửi phiếu" }));
    await waitFor(() => expect(onCast).toHaveBeenCalledTimes(1));
    expect(requestMock).toHaveBeenCalledWith(BALLOT, { method: "POST", body: { choice: "ABSTAIN" } });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reports any other refusal and does not confirm the vote", async () => {
    requestMock.mockRejectedValue(
      new ApiError("bạn không thuộc danh sách bỏ phiếu của nội dung này", "not_on_roll", 403),
    );
    const onCast = vi.fn();
    render(wrapWithNav(<MeetingMotionBallot meetingId="m1" motion={motion({ status: "OPEN" })} onCast={onCast} />));
    fireEvent.click(screen.getByRole("radio", { name: "Tán thành" }));
    fireEvent.click(screen.getByRole("button", { name: "Gửi phiếu" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("bạn không thuộc danh sách bỏ phiếu của nội dung này"),
    );
    expect(onCast).not.toHaveBeenCalled();
  });
});

describe("MeetingMotionCard — closed", () => {
  const closed = (over: Partial<MeetingMotion> = {}) =>
    motion({
      status: "CLOSED",
      roll_size: 4,
      total_members: 6,
      cast_count: 4,
      result: { yes: 3, no: 1, abstain: 0, required: 3, outcome: "PASSED" },
      ...over,
    });

  it("shows the outcome, the bar's numbers and a folded list of who chose what", async () => {
    renderCard(closed({ voters: { yes: ["An", "Bình", "Chi"], no: ["Dũng"], abstain: [] } }));
    expect(screen.getByText("Đã đóng")).toBeInTheDocument();
    expect(screen.getByText("Thông qua")).toBeInTheDocument();
    expect(screen.getByText("Cần 3/4 phiếu tán thành")).toBeInTheDocument();
    expect(screen.getByText("Tán thành: 3 (75%)")).toBeInTheDocument();
    expect(screen.getByText("Không tán thành: 1 (25%)")).toBeInTheDocument();
    expect(screen.getByText("Không ý kiến: 0 (0%)")).toBeInTheDocument();
    expect(screen.queryByText("An, Bình, Chi")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem ai chọn gì" }));
    expect(await screen.findByText("An, Bình, Chi")).toBeInTheDocument();
    expect(screen.getByText("Dũng")).toBeInTheDocument();
    expect(screen.getByText("Không ai")).toBeInTheDocument();
  });

  it("counts against all members when the base says so", () => {
    renderCard(
      closed({ base: "ALL_MEMBERS", result: { yes: 3, no: 1, abstain: 0, required: 4, outcome: "FAILED" } }),
    );
    expect(screen.getByText("Không thông qua")).toBeInTheDocument();
    expect(screen.getByText("Cần 4/6 phiếu tán thành")).toBeInTheDocument();
    expect(screen.getByText("Tán thành: 3 (50%)")).toBeInTheDocument();
  });

  it("never lists names for a secret ballot", () => {
    renderCard(closed({ ballot_mode: "SECRET", voters: null }));
    expect(screen.getByText("Bỏ phiếu kín — không hiện ai chọn gì.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xem ai chọn gì" })).not.toBeInTheDocument();
    expect(screen.getByText("Tán thành: 3 (75%)")).toBeInTheDocument();
  });

  it("says there were no voters instead of dividing by zero", () => {
    renderCard(
      closed({
        roll_size: 0,
        cast_count: 0,
        result: { yes: 0, no: 0, abstain: 0, required: 0, outcome: "FAILED" },
        voters: { yes: [], no: [], abstain: [] },
      }),
    );
    expect(screen.getByText("Không thông qua")).toBeInTheDocument();
    expect(screen.getByText("Không có cử tri")).toBeInTheDocument();
    expect(screen.getByText("Tán thành: 0 (0%)")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });
});
