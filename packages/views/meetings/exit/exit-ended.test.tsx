import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingExitScreen } from "./meeting-exit-screen";

const me: User = {
  id: "u-me",
  email: "me@x.com",
  display_name: "Võ Minh",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Tổng kết dự án Sao Mai",
  description: "",
  starts_at: "2026-10-27T08:40:00Z",
  ends_at: "2026-10-27T09:40:00Z",
  actual_start_at: "2026-10-27T08:40:00Z",
  actual_end_at: "2026-10-27T09:21:00Z",
  status: "ENDED",
  host_user_id: "u-host",
  room_name: "uw_mtg_m1",
  created_by: "u-host",
} as Meeting;

let prefs: unknown[] = [];
let run = { status: "running", at: "2026-10-27T09:21:05Z", attempts: 1 };

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  prefs = [];
  run = { status: "running", at: "2026-10-27T09:21:05Z", attempts: 1 };
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/activity"))
      return Promise.resolve({ activity: [{ id: "a1", event_type: "MEETING_ENDED", actor_id: "u-host", occurred_at: "2026-10-27T09:21:00Z" }] });
    if (path.endsWith("/attendance"))
      return Promise.resolve({ summary: { members: 7, present: 5, late: 1, excused: 0, absent: 1 }, rows: [] });
    if (path.endsWith("/recordings"))
      return Promise.resolve({ recordings: [{ id: "r1", meeting_id: "m1", status: "PROCESSING", started_at: "2026-10-27T08:42:00Z", ended_at: "2026-10-27T09:20:12Z" }] });
    if (path.endsWith("/action-items"))
      return Promise.resolve({
        items: [
          { id: "i1", title: "Gửi báo giá giai đoạn 2 cho Sao Mai", status: "PENDING", suggested_assignee_id: "u-me", suggested_due_date: "2026-10-30", evidence: [] },
          { id: "i2", title: "Cập nhật timeline triển khai", status: "PENDING", suggested_assignee_id: "u-me", suggested_due_date: "2026-10-30", evidence: [] },
          { id: "i3", title: "Việc của người khác", status: "PENDING", suggested_assignee_id: "u-lan", evidence: [] },
        ],
        counts: { pending: 3, converted: 0, dismissed: 0, tasks_done: 0 },
      });
    if (path.endsWith("/summary")) return Promise.resolve({ summary: null, run });
    if (path.endsWith("/notification-preferences")) return Promise.resolve({ preferences: prefs });
    if (path.includes("/members"))
      return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u-host", role: "owner", email: "h@x.com", display_name: "Demo UniChat" }] });
    return Promise.resolve({});
  });
});

function renderEnded() {
  const handlers = { onRejoin: vi.fn(), onBackToMeeting: vi.fn() };
  const nav = fakeNav("/demo/team/meetings/m1/room");
  render(
    wrapWithNav(
      <MeetingExitScreen
        exit={{ kind: "ended", at: "2026-10-27T09:21:00Z" }}
        meetingId="m1"
        meeting={meeting}
        workspaceId="w1"
        meetingsHref="/demo/team/meetings"
        selfParticipantId="me"
        {...handlers}
      />,
      nav,
    ),
  );
  return { ...handlers, nav };
}

describe("leave screen D: the meeting ended", () => {
  it("says who ended it and when, with how long, how many and the recording", async () => {
    renderEnded();
    expect(await screen.findByRole("heading", { name: "Cuộc họp đã kết thúc" })).toBeInTheDocument();
    expect(await screen.findByText(/Demo UniChat kết thúc lúc \d{2}:21/)).toBeInTheDocument();
    expect(screen.getByText("41 phút")).toBeInTheDocument();
    expect(await screen.findByText("6 người")).toBeInTheDocument();
    expect(await screen.findByText("38:12")).toBeInTheDocument();
  });

  it("shows the scribe writing the minutes, what it caught, and the viewer's own items", async () => {
    renderEnded();
    expect(await screen.findByText("Thư ký UNI đang soạn biên bản")).toBeInTheDocument();
    expect(await screen.findByText("3 việc")).toBeInTheDocument();
    expect(screen.getByText("Báo tôi khi xong")).toBeInTheDocument();
    expect(await screen.findByText("Gửi báo giá giai đoạn 2 cho Sao Mai")).toBeInTheDocument();
    expect(screen.getByText("Cập nhật timeline triển khai")).toBeInTheDocument();
    expect(screen.queryByText("Việc của người khác")).not.toBeInTheDocument();
  });

  it("drops the notify chip when every channel of that notification is off", async () => {
    prefs = [{ kind: "meeting_recap_ready", in_app: false, push: false, email: false }];
    renderEnded();
    await screen.findByText("Thư ký UNI đang soạn biên bản");
    expect(screen.queryByText("Báo tôi khi xong")).not.toBeInTheDocument();
  });

  it("goes to the meeting page or the meetings list", async () => {
    const { onBackToMeeting, nav } = renderEnded();
    fireEvent.click(await screen.findByRole("button", { name: "Xem trang cuộc họp" }));
    expect(onBackToMeeting).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("link", { name: "Về danh sách cuộc họp" }));
    expect(nav.push).toHaveBeenCalledWith("/demo/team/meetings");
  });
});
