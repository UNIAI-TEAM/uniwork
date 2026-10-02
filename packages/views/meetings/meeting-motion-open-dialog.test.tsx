import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, MeetingMotion } from "@uniwork/core/types/meeting";
import { toast } from "sonner";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingMotionOpenDialog } from "./meeting-motion-open-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const meeting = {
  id: "m1", workspace_id: "ws1", title: "Giao ban", description: "", starts_at: "2026-10-01T02:00:00Z",
  ends_at: "2026-10-01T03:00:00Z", room_name: "r", created_by: "u1", status: "IN_PROGRESS",
} as Meeting;
const motion = {
  id: "mo1", title: "Thông qua kế hoạch", description: "", position: 1, ballot_mode: "SECRET",
  threshold: "MAJORITY", base: "PRESENT", status: "DRAFT", roll_size: null, total_members: null,
  cast_count: 0, result: null, voters: null, my_ballot: { on_roll: false, cast: false, choice: null },
} as MeetingMotion;
let attendance: Record<string, unknown>;
const onOpenChange = vi.fn();

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  requestMock.mockReset();
  onOpenChange.mockReset();
  vi.mocked(toast.success).mockReset();
  attendance = {
    quorum_percent: null,
    summary: { members: 3, present: 1, late: 1, excused: 0, absent: 1, quorum_met: null },
    rows: [],
  };
  requestMock.mockImplementation((path: unknown) =>
    Promise.resolve(String(path).endsWith("/attendance") ? attendance : { status: "ok" }),
  );
});

function renderDialog() {
  render(
    wrapWithNav(
      <MeetingMotionOpenDialog meeting={meeting} meetingId="m1" motion={motion} open onOpenChange={onOpenChange} />,
    ),
  );
}

describe("MeetingMotionOpenDialog", () => {
  it("counts the members present and late as the roll, and says late joiners are out", async () => {
    renderDialog();
    const dialog = await screen.findByRole("alertdialog");
    expect(await within(dialog).findByText("2 thành viên tham dự sẽ được bỏ phiếu.")).toBeInTheDocument();
    expect(within(dialog).getByText("“Thông qua kế hoạch”")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Người vào phòng sau khi mở sẽ không được bỏ phiếu nội dung này."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
  });

  it("leaves out of the roll a finalized attendee who has since been removed", async () => {
    attendance.finalized_at = "2026-10-01T02:30:00Z";
    attendance.rows = [
      { participant_id: "p9", principal_type: "USER", display_name: "Bình", standing: "MEMBER", is_secretary: false,
        status: "PRESENT", source: "MANUAL", present_seconds: 0, session_count: 0, removed: true },
    ];
    renderDialog();
    expect(await screen.findByText("1 thành viên tham dự sẽ được bỏ phiếu.")).toBeInTheDocument();
  });

  it("warns when attendance is below the minimum, without blocking", async () => {
    attendance.quorum_percent = 80;
    attendance.summary = { members: 3, present: 1, late: 1, excused: 0, absent: 1, quorum_met: false };
    renderDialog();
    expect(await screen.findByText("Chưa đủ tỉ lệ có mặt tối thiểu (cần 80%).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mở biểu quyết" })).toBeEnabled();
  });

  it("warns that nobody can vote when no member is present", async () => {
    attendance.summary = { members: 2, present: 0, late: 0, excused: 1, absent: 1, quorum_met: null };
    renderDialog();
    expect(
      await screen.findByText("Chưa có thành viên nào tham dự — sẽ không ai bỏ phiếu được."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 thành viên tham dự sẽ được bỏ phiếu.")).toBeInTheDocument();
  });

  it("opens the vote on confirm and closes itself", async () => {
    renderDialog();
    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText("2 thành viên tham dự sẽ được bỏ phiếu.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mở biểu quyết" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/motions/mo1/open", { method: "POST" }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Đã mở biểu quyết");
  });
});
