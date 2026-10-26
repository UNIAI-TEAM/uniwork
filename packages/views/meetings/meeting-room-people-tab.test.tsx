import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import type { Meeting, User } from "@uniwork/core/types";
import { ParticipantKind, RoomEvent } from "livekit-client";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingModerationProvider } from "./meeting-moderation";
import { MeetingRoomPeopleTab } from "./meeting-room-people-tab";

const live = vi.hoisted(() => ({ participants: [] as unknown[], options: [] as unknown[] }));
const signals = vi.hoisted(() => ({ hands: [] as string[], toggleHand: vi.fn() }));

vi.mock("@livekit/components-react", () => ({
  useParticipants: (options?: unknown) => {
    live.options.push(options);
    return live.participants;
  },
  useIsSpeaking: () => false,
  useIsMuted: () => false,
}));
vi.mock("./use-meeting-signals", () => ({
  useMeetingSignals: () => signals,
  useRequestMute: () => vi.fn(),
}));
vi.mock("./meeting-room-avatars", () => ({
  useRoomAvatarOf: () => () => undefined,
  useRoomTintOf: () => () => "gray",
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
  live.options = [];
  signals.hands = [];
  signals.toggleHand.mockReset();
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
    expect(roll).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(roll);
    expect(roll).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("button", { name: "Chốt điểm danh" })).toBeInTheDocument();
    // Latecomers knock while the roll is being taken; they must stay in view.
    expect(screen.getByRole("region", { name: "Khách muộn đang chờ" })).toBeInTheDocument();
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
    expect(await screen.findByText("Trong phòng · 0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Điểm danh" })).not.toBeInTheDocument();
  });

  describe("the host's row", () => {
    // The host as another person sees them in the room: an admin moderating.
    const hostInRoom = {
      identity: "uw_participant_p-host", name: "Chủ trì", isLocal: false, permissions: null, getTrackPublication: () => undefined, on: vi.fn(), off: vi.fn(),
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

    it("offers the room mic only while the AI scribe is in the room", async () => {
      renderAsAdmin();
      fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Chủ trì" }));
      expect(await screen.findByRole("menuitem", { name: "Chuyển sang dự thính" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Đặt làm mic hội trường" })).not.toBeInTheDocument();
    });

    it("offers the room mic to a clerk when the AI scribe listens", async () => {
      setSessionUser({ ...me, id: "u-admin", display_name: "Admin" });
      live.participants = [hostInRoom, { ...hostInRoom, identity: "uw_agent_scribe", name: "UniWork AI", isAgent: true }];
      render(
        wrapWithNav(
          <MeetingModerationProvider meetingId="m1" canHost>
            <MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />
          </MeetingModerationProvider>,
        ),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Chủ trì" }));
      expect(await screen.findByRole("menuitem", { name: "Đặt làm mic hội trường" })).toBeInTheDocument();
    });

    it("never offers the room mic for a phone caller", async () => {
      // A phone row matched to its record (today a SIP identity never is):
      // the scribe would have to diarize the phone line under the caller's id.
      // Admitted, so the roster lists it: a held caller is not listed at all.
      const phone = {
        ...hostInRoom,
        identity: "uw_participant_p-host",
        name: "Điện thoại ••• 1234",
        kind: ParticipantKind.SIP,
        attributes: { "uw.dial_in": "admitted" },
      };
      setSessionUser({ ...me, id: "u-admin", display_name: "Admin" });
      live.participants = [phone, { ...hostInRoom, identity: "uw_agent_scribe", name: "UniWork AI", isAgent: true }];
      render(
        wrapWithNav(
          <MeetingModerationProvider meetingId="m1" canHost>
            <MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />
          </MeetingModerationProvider>,
        ),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Điện thoại ••• 1234" }));
      expect(await screen.findByRole("menuitem", { name: "Chuyển sang dự thính" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Đặt làm mic hội trường" })).not.toBeInTheDocument();
    });

    it("says on the row whose mic is the room mic", async () => {
      const base = requestMock.getMockImplementation();
      requestMock.mockImplementation((path: unknown, init?: unknown) =>
        String(path).endsWith("/participants")
          ? Promise.resolve({
              participants: [
                { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", role: "MODERATOR", status: "ACTIVE", standing: "MEMBER", shared_mic: true },
              ],
            })
          : base?.(path, init),
      );
      renderAsAdmin();
      expect(await screen.findByText(/Mic hội trường/)).toBeInTheDocument();
    });

    it("names a phone caller once: the server's name already says phone", async () => {
      const phone = {
        ...hostInRoom,
        identity: "uw_participant_p-phone",
        name: "Điện thoại ••• 1234",
        kind: ParticipantKind.SIP,
        attributes: { "uw.dial_in": "admitted" },
      };
      setSessionUser({ ...me, id: "u-admin", display_name: "Admin" });
      live.participants = [phone];
      render(
        wrapWithNav(
          <MeetingModerationProvider meetingId="m1" canHost>
            <MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />
          </MeetingModerationProvider>,
        ),
      );
      expect(await screen.findByText("Điện thoại ••• 1234")).toBeInTheDocument();
      expect(screen.queryByText("Điện thoại", { exact: true })).not.toBeInTheDocument();
    });

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

  it("does not read the roll for a viewer who cannot host, nor for a guest", async () => {
    live.participants = [];
    const first = render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" />));
    expect(await screen.findByText("Trong phòng · 0")).toBeInTheDocument();
    first.unmount();
    render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} canHost guestMode />));
    expect(await screen.findByText("Trong phòng · 0")).toBeInTheDocument();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants"));
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/attendance");
  });

  describe("a large room", () => {
    const person = (name: string, identity = `id-${name}`) => ({
      identity, name, isLocal: false, permissions: null, getTrackPublication: () => undefined, on: vi.fn(), off: vi.fn(),
    });

    it("follows the roster on joins, leaves, renames and attribute changes only", async () => {
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" />));
      expect(await screen.findByText("Trong phòng · 0")).toBeInTheDocument();
      expect(live.options[0]).toEqual({
        updateOnlyOn: [RoomEvent.ParticipantNameChanged, RoomEvent.ParticipantAttributesChanged],
      });
    });

    it("sorts names the way the language reads them", async () => {
      live.participants = [person("Đức"), person("Dũng"), person("an"), person("Bình")];
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" />));
      await screen.findByText("Trong phòng · 4");
      const names = screen.getAllByRole("listitem").map((li) => li.textContent);
      expect(names).toEqual([
        expect.stringContaining("an"),
        expect.stringContaining("Bình"),
        expect.stringContaining("Dũng"),
        expect.stringContaining("Đức"),
      ]);
    });

    it("mounts only the rows near the viewport, keeping each one's place in the list", async () => {
      live.participants = Array.from({ length: 300 }, (_, i) => person(`Người ${String(i).padStart(3, "0")}`));
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" />));
      await screen.findByText("Trong phòng · 300");
      const rows = screen.getAllByRole("listitem");
      expect(rows.length).toBeLessThan(40);
      expect(rows[0]).toHaveAttribute("aria-setsize", "300");
      expect(rows[0]).toHaveAttribute("aria-posinset", "1");
      expect(rows[0]).toHaveTextContent("Người 000");
      // The count still says everyone, and search still reaches the last row.
      expect(screen.getByText("Trong phòng · 300")).toBeInTheDocument();
      fireEvent.change(screen.getByRole("textbox", { name: "Tìm người" }), { target: { value: "299" } });
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByRole("listitem")).toHaveTextContent("Người 299");
      expect(screen.getByText("Trong phòng · 1")).toBeInTheDocument();
    });

    it("offers the host mute everyone once someone else is in the room", async () => {
      live.participants = [person("Lan", "uw_participant_p2"), { ...person("Me", "uw_participant_p-host"), isLocal: true }];
      render(
        wrapWithNav(
          <MeetingModerationProvider meetingId="m1" canHost>
            <MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />
          </MeetingModerationProvider>,
        ),
      );
      expect(await screen.findByRole("button", { name: "Tắt mic mọi người" })).toBeInTheDocument();
    });
  });
  describe("the redesigned tab", () => {
    const person = (name: string, identity = `id-${name}`, extra: Record<string, unknown> = {}) => ({
      identity, name, isLocal: false, permissions: null, getTrackPublication: () => undefined, on: vi.fn(), off: vi.fn(), ...extra,
    });

    function waitingTwo() {
      const base = requestMock.getMockImplementation();
      requestMock.mockImplementation((path: unknown, ...rest: unknown[]) =>
        String(path).endsWith("/join-requests")
          ? Promise.resolve({
              join_requests: [
                { id: "jr1", meeting_id: "m1", display_name_snapshot: "Khách muộn", status: "PENDING" },
                { id: "jr2", meeting_id: "m1", display_name_snapshot: "Đức Hải", status: "PENDING" },
              ],
            })
          : base?.(path, ...rest),
      );
    }

    it("shows the host one waiting card and admits everyone from it", async () => {
      waitingTwo();
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
      expect(await screen.findByRole("region", { name: "Khách muộn và 1 người khác đang chờ" })).toBeInTheDocument();
      // The per-person rows stay folded until the chevron opens them.
      expect(screen.queryByText("Đức Hải")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cho vào cả 2 người" }));
      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("/meeting-join-requests/jr1/approve"), expect.any(Object));
        expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("/meeting-join-requests/jr2/approve"), expect.any(Object));
      });
    });

    it("admits the one person waiting, and opens the rows on the chevron", async () => {
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
      expect(await screen.findByRole("region", { name: "Khách muộn đang chờ" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Xem từng người" }));
      expect(await screen.findAllByText("Khách muộn")).toHaveLength(2);
      expect(screen.getByRole("button", { name: "Cho Khách muộn vào" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cho vào" }));
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("/meeting-join-requests/jr1/approve"), expect.any(Object)),
      );
    });

    it("drops the old headings and counts only people in the room", async () => {
      live.participants = [person("Lan"), person("UniWork AI", "uw_agent_scribe", { isAgent: true })];
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
      expect(await screen.findByText("Trong phòng · 1")).toBeInTheDocument();
      expect(screen.queryByText("Trong cuộc họp")).not.toBeInTheDocument();
      expect(screen.queryByText("Người tham gia")).not.toBeInTheDocument();
    });

    it("puts the AI scribe first in the room while it is there", async () => {
      live.participants = [person("An"), person("UniWork AI", "uw_agent_scribe", { isAgent: true })];
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
      const scribe = await screen.findByText("Thư ký UNI");
      expect(screen.getByText("Trợ lý AI · đang ghi")).toBeInTheDocument();
      const firstPerson = screen.getAllByRole("listitem")[0]!;
      expect(firstPerson).toHaveTextContent("An");
      expect(scribe.compareDocumentPosition(firstPerson) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The scribe has no menu: nobody moderates it.
      expect(screen.queryByRole("button", { name: /Thao tác với UniWork AI/ })).not.toBeInTheDocument();
    });

    it("has no scribe row when the scribe is not in the room", async () => {
      live.participants = [person("An")];
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
      await screen.findByText("Trong phòng · 1");
      expect(screen.queryByText("Thư ký UNI")).not.toBeInTheDocument();
    });

    it("lists raised hands in order, and lets you lower only your own", async () => {
      const self = person("Me", "uw_participant_p-host", { isLocal: true });
      live.participants = [person("Bình"), self, person("An")];
      signals.hands = ["id-Bình", "uw_participant_p-host"];
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
      const hands = await screen.findByRole("list", { name: "Giơ tay · 2" });
      // It scrolls past six hands, so a keyboard can reach it to scroll.
      expect(hands).toHaveAttribute("tabindex", "0");
      const rows = within(hands).getAllByRole("listitem");
      expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/^1.*Bình/), expect.stringMatching(/^2.*Me/)]);
      expect(within(rows[0]!).queryByRole("button", { name: "Hạ tay" })).not.toBeInTheDocument();
      fireEvent.click(within(rows[1]!).getByRole("button", { name: "Hạ tay" }));
      expect(signals.toggleHand).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole("button", { name: "Hạ tay" })).toHaveLength(1);
    });

    it("lists you first after the raised hands", async () => {
      live.participants = [person("An"), person("Bình"), person("Me", "uw_participant_p-host", { isLocal: true }), person("Cường")];
      signals.hands = ["id-Bình"];
      render(wrapWithNav(<MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />));
      const room = await screen.findByRole("list", { name: "Trong phòng · 4" });
      expect(within(room).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        expect.stringContaining("Bình"),
        expect.stringContaining("Me"),
        expect.stringContaining("An"),
        expect.stringContaining("Cường"),
      ]);
      expect(within(room).getAllByRole("listitem")[1]).toHaveTextContent("bạn");
    });

    it("gives the host the add, mute-everyone and roll buttons", async () => {
      live.participants = [person("Lan", "uw_participant_p2"), person("Me", "uw_participant_p-host", { isLocal: true })];
      render(
        wrapWithNav(
          <MeetingModerationProvider meetingId="m1" canHost>
            <MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" canHost />
          </MeetingModerationProvider>,
        ),
      );
      expect(await screen.findByRole("button", { name: "Điểm danh" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Thêm người" }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Tắt mic mọi người" }));
      // The confirmation stays: muting a whole room is never one click.
      expect(await screen.findByRole("alertdialog", { name: "Tắt mic mọi người?" })).toBeInTheDocument();
    });

    it("gives a participant only search and the lists", async () => {
      setSessionUser({ ...me, id: "u-lan", display_name: "Lan" });
      const base = requestMock.getMockImplementation();
      requestMock.mockImplementation((path: unknown, ...rest: unknown[]) =>
        String(path).endsWith("/me")
          ? Promise.resolve({ membership: { user_id: "u-lan", role: "member", source: "membership" } })
          : base?.(path, ...rest),
      );
      live.participants = [person("Lan", "uw_participant_p2", { isLocal: true }), person("Chủ trì", "uw_participant_p-host")];
      render(
        wrapWithNav(
          <MeetingModerationProvider meetingId="m1" canHost={false}>
            <MeetingRoomPeopleTab meetingId="m1" meeting={meeting} workspaceId="w1" />
          </MeetingModerationProvider>,
        ),
      );
      expect(await screen.findByText("Trong phòng · 2")).toBeInTheDocument();
      await waitFor(() => expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("/me")));
      expect(screen.getByRole("textbox", { name: "Tìm người" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Thêm người" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Tắt mic mọi người" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Điểm danh" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /đang chờ/ })).not.toBeInTheDocument();
    });
  });
});
