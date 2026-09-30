import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import type { Meeting, User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomPeopleTab } from "./meeting-room-people-tab";

vi.mock("@livekit/components-react", () => ({
  useParticipants: () => [],
  useIsSpeaking: () => false,
  useIsMuted: () => false,
}));
vi.mock("./use-meeting-signals", () => ({
  useMeetingSignals: () => ({ hands: [] }),
  useRequestMute: () => vi.fn(),
}));
vi.mock("./meeting-room-avatars", () => ({
  useRoomAvatarOf: () => () => undefined,
  useUserAvatarOf: () => () => undefined,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const me: User = {
  id: "u-host",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const meeting = {
  id: "m1", workspace_id: "w1", title: "Giao ban", description: "", starts_at: "2026-09-30T02:00:00Z",
  ends_at: "2026-09-30T03:00:00Z", room_name: "r", created_by: "u-host", status: "IN_PROGRESS", host_user_id: "u-host",
} as Meeting;

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  useMeetingViewSessionStore.getState().reset();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u-host", role: "owner", source: "membership" } });
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/participants")) {
      return Promise.resolve({
        participants: [
          { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", role: "MODERATOR", status: "ACTIVE", standing: "MEMBER" },
        ],
      });
    }
    if (p.endsWith("/attendance")) {
      return Promise.resolve({
        summary: { members: 1, present: 1, late: 0, excused: 0, absent: 0 },
        rows: [
          { participant_id: "p-host", principal_type: "USER", display_name: "Me", standing: "MEMBER", is_secretary: false, status: "PRESENT", source: "SUGGESTED", present_seconds: 60, session_count: 1 },
        ],
      });
    }
    if (p.endsWith("/join-requests")) {
      return Promise.resolve({
        join_requests: [{ id: "jr1", meeting_id: "m1", display_name_snapshot: "Khách muộn", status: "PENDING" }],
      });
    }
    return Promise.resolve({});
  });
});

describe("MeetingRoomPeopleTab", () => {
  it("lets a clerk switch to the roll", async () => {
    render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
    const roll = await screen.findByRole("button", { name: "Điểm danh" });
    expect(screen.getByRole("button", { name: "Trong phòng" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(roll);
    expect(roll).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("button", { name: "Chốt điểm danh" })).toBeInTheDocument();
    // Latecomers knock while the roll is being taken; they must stay in view.
    expect(screen.getByText("Khách muộn")).toBeInTheDocument();
  });

  it("keeps the clerk's view when the sidebar closes and reopens", async () => {
    const view = render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
    fireEvent.click(await screen.findByRole("button", { name: "Điểm danh" }));
    view.unmount();
    render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
    expect(await screen.findByRole("button", { name: "Điểm danh" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers no roll to a guest", async () => {
    render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} guestMode />));
    expect(await screen.findByText("Trong cuộc họp")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Điểm danh" })).not.toBeInTheDocument();
  });
});
