import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import type { Meeting, User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingModerationProvider } from "./meeting-moderation";
import { MeetingRoomPeopleTab } from "./meeting-room-people-tab";

const live = vi.hoisted(() => ({ participants: [] as unknown[] }));

vi.mock("@livekit/components-react", () => ({
  useParticipants: () => live.participants,
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
  live.participants = [];
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

  describe("the host's row", () => {
    // The host as another person sees them in the room: an admin moderating.
    const hostInRoom = {
      identity: "uw_participant_p-host", name: "Chủ trì", isLocal: false, permissions: null, on: vi.fn(), off: vi.fn(),
    };
    const finalizedRoll = {
      finalized_at: "2026-09-30T03:00:00Z",
      summary: { members: 1, present: 1, late: 0, excused: 0, absent: 0 },
      rows: [
        { participant_id: "p-host", principal_type: "USER", display_name: "Chủ trì", standing: "MEMBER", is_secretary: false, status: "PRESENT", source: "AUTO", present_seconds: 60, session_count: 1 },
      ],
    };

    function renderAsAdmin() {
      setSessionUser({ ...me, id: "u-admin", display_name: "Admin" });
      live.participants = [hostInRoom];
      render(
        wrapWithNav(
          <MeetingModerationProvider meetingId="m1" canHost>
            <MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />
          </MeetingModerationProvider>,
        ),
      );
    }

    it("offers its standing but never removing the host", async () => {
      renderAsAdmin();
      fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Chủ trì" }));
      expect(await screen.findByRole("menuitem", { name: "Chuyển sang dự thính" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Khóa mic của Chủ trì" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Mời Chủ trì ra khỏi cuộc họp" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Giao vai thư ký" })).not.toBeInTheDocument();
    });

    it("locks the standing, with the reason, once the roll is finalized", async () => {
      const base = requestMock.getMockImplementation();
      requestMock.mockImplementation((path: unknown, ...rest: unknown[]) =>
        String(path).endsWith("/attendance") ? Promise.resolve(finalizedRoll) : base?.(path, ...rest),
      );
      renderAsAdmin();
      await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance"));
      fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Chủ trì" }));
      const standing = await screen.findByRole("menuitem", { name: "Chuyển sang dự thính" });
      await waitFor(() => expect(standing).toHaveAttribute("aria-disabled", "true"));
      expect(screen.getByText("Mở lại điểm danh để đổi tư cách")).toBeInTheDocument();
    });
  });

  describe("chips and search in the room view", () => {
    const person = (id: string, name: string) => ({
      identity: `uw_participant_${id}`, name, isLocal: false, permissions: null, on: vi.fn(), off: vi.fn(),
    });

    function renderRoom() {
      const base = requestMock.getMockImplementation();
      requestMock.mockImplementation((path: unknown, ...rest: unknown[]) =>
        String(path).endsWith("/participants")
          ? Promise.resolve({
              participants: [
                { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", role: "MODERATOR", status: "ACTIVE", standing: "MEMBER" },
                { id: "g-obs", meeting_id: "m1", principal_type: "GUEST", role: "ATTENDEE", status: "ACTIVE", standing: "OBSERVER" },
                { id: "g-mem", meeting_id: "m1", principal_type: "GUEST", role: "ATTENDEE", status: "ACTIVE", standing: "MEMBER" },
                { id: "p-tuan", meeting_id: "m1", principal_type: "USER", user_id: "u-tuan", role: "ATTENDEE", status: "ACTIVE", standing: "MEMBER" },
              ],
            })
          : base?.(path, ...rest),
      );
      live.participants = [
        person("g-obs", "Khách Một"),
        person("g-mem", "Khách Hai"),
        person("p-tuan", "Trần Tuấn"),
      ];
      render(
        wrapWithNav(
          <MeetingModerationProvider meetingId="m1" canHost>
            <MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />
          </MeetingModerationProvider>,
        ),
      );
    }

    const rowOf = (name: string) => screen.getByText(name).closest("li")!;

    it("shows a guest's standing beside the guest chip, and no chip on a plain member", async () => {
      renderRoom();
      await waitFor(() => expect(within(rowOf("Khách Một")).getByText("Dự thính")).toBeInTheDocument());
      expect(within(rowOf("Khách Một")).getByText("Khách")).toBeInTheDocument();
      // Promoted to member: still a guest, and members carry no standing chip.
      expect(within(rowOf("Khách Hai")).getByText("Khách")).toBeInTheDocument();
      expect(within(rowOf("Khách Hai")).queryByText("Dự thính")).not.toBeInTheDocument();
      expect(within(rowOf("Trần Tuấn")).queryByText("Khách")).not.toBeInTheDocument();
      expect(within(rowOf("Trần Tuấn")).queryByText("Dự thính")).not.toBeInTheDocument();
    });

    it("finds a name typed without its accents", async () => {
      renderRoom();
      await screen.findByText("Trần Tuấn");
      fireEvent.change(screen.getByRole("textbox", { name: "Tìm người tham dự" }), { target: { value: "tuan" } });
      expect(screen.getByText("Trần Tuấn")).toBeInTheDocument();
      expect(screen.queryByText("Khách Một")).not.toBeInTheDocument();
    });
  });

  it("does not read the roll for a viewer who cannot host, nor for a guest", async () => {
    live.participants = [];
    const first = render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" />));
    expect(await screen.findByText("Trong cuộc họp")).toBeInTheDocument();
    first.unmount();
    render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} canHost guestMode />));
    expect(await screen.findByText("Trong cuộc họp")).toBeInTheDocument();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants"));
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/attendance");
  });
});
