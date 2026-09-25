import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingDetailView } from "./meeting-detail-view";
import { MeetingsPageView } from "./meetings-page-view";
import { MeetingRoomView } from "./room-view";

import { DisconnectReason } from "livekit-client";

let lastDisconnected: ((reason?: DisconnectReason) => void) | undefined;
let lastLiveKitMedia: { video?: boolean; audio?: boolean } | undefined;
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({
    children,
    onDisconnected,
    video,
    audio,
  }: {
    children: React.ReactNode;
    onDisconnected?: (reason?: DisconnectReason) => void;
    video?: boolean;
    audio?: boolean;
  }) => {
    lastDisconnected = onDisconnected;
    lastLiveKitMedia = { video, audio };
    return <div data-testid="livekit-room">{children}</div>;
  },
  useRoomContext: () => ({
    engine: { token: "tok" },
    regionUrlProvider: { updateToken: vi.fn() },
  }),
}));
vi.mock("./meeting-conference", () => ({
  MeetingConference: () => <div data-testid="livekit-conference" />,
}));
vi.mock("@livekit/components-styles", () => ({}));

initI18n();

const me: User = {
  id: "u-host",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};

function windowFromNow(startOffsetMs: number, durationMs = 30 * 60_000): { starts_at: string; ends_at: string } {
  const start = Date.now() + startOffsetMs;
  return {
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + durationMs).toISOString(),
  };
}

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  description: "agenda",
  ...windowFromNow(60 * 60_000),
  room_name: "uw_mtg_m1",
  created_by: "u-host",
  status: "SCHEDULED",
  host_user_id: "u-host",
};

function shell(ui: React.ReactElement) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  requestMock.mockReset();
  setSessionUser(me);
  lastDisconnected = undefined;
  lastLiveKitMedia = undefined;
});

describe("MeetingDetailView", () => {
  it("shows host start and cancel, and the join lobby entry", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/me")) {
        return Promise.resolve({ membership: { user_id: "u-host", role: "owner", source: "membership" } });
      }
      if (p.endsWith("/members")) {
        return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" }] });
      }
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      if (p.endsWith("/participants")) return Promise.resolve({ participants: [] });
      if (p.endsWith("/join-requests")) return Promise.resolve({ join_requests: [] });
      if (p.endsWith("/invite-links")) return Promise.resolve({ invite_links: [] });
      if (p.endsWith("/activity")) return Promise.resolve({ activity: [] });
      return Promise.resolve({});
    });
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));
    expect(await screen.findByRole("button", { name: "Bắt đầu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bắt đầu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vào phòng họp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hủy cuộc họp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sửa cuộc họp" })).toBeInTheDocument();
    // Nobody else is on the roster, so there is nobody to hand the host role to.
    expect(screen.queryByRole("menuitem", { name: "Chuyển chủ trì…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chuyển chủ trì/ })).not.toBeInTheDocument();
  });

  it("uses a single-column detail layout inside a contextual panel", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/me")) {
        return Promise.resolve({ membership: { user_id: "u-host", role: "owner", source: "membership" } });
      }
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      if (p.endsWith("/participants")) return Promise.resolve({ participants: [] });
      if (p.endsWith("/join-requests")) return Promise.resolve({ join_requests: [] });
      if (p.endsWith("/invite-links")) return Promise.resolve({ invite_links: [] });
      if (p.endsWith("/activity")) return Promise.resolve({ activity: [] });
      return Promise.resolve({});
    });
    render(
      shell(
        <MeetingDetailView
          workspaceId="w1"
          meetingId="m1"
          layout="panel"
          headerActions={<button type="button">Panel action</button>}
          onJoin={() => {}}
          onDeleted={() => {}}
        />,
      ),
    );

    expect(await screen.findByRole("button", { name: "Panel action" })).toBeInTheDocument();
    expect(screen.getByTestId("meeting-detail-content")).toHaveClass("max-w-none");
    expect(screen.getByTestId("meeting-detail-sections")).not.toHaveClass("lg:grid");
  });

  it("says the meeting is gone instead of loading forever", async () => {
    requestMock.mockImplementation((path: unknown) => {
      if (String(path) === "/api/v1/meetings/m1") {
        return Promise.reject(new ApiError("không tìm thấy", "not_found", 404));
      }
      return Promise.resolve({});
    });
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));

    expect(await screen.findByRole("heading", { name: "Không tìm thấy cuộc họp" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Về danh sách cuộc họp" })).toHaveAttribute("href", "/org/team/meetings");
    expect(screen.queryByText("Đang tải…")).not.toBeInTheDocument();
  });

  it("offers a retry when the meeting could not be loaded", async () => {
    let calls = 0;
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p === "/api/v1/meetings/m1") {
        calls += 1;
        return calls === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve({ meeting });
      }
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      if (p.endsWith("/participants")) return Promise.resolve({ participants: [] });
      if (p.endsWith("/join-requests")) return Promise.resolve({ join_requests: [] });
      if (p.endsWith("/activity")) return Promise.resolve({ activity: [] });
      return Promise.resolve({});
    });
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));

    expect(await screen.findByRole("heading", { name: "Chưa tải được cuộc họp" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("heading", { name: "Standup" })).toBeInTheDocument();
  });

  function rosterMock(overrides: (path: string, method?: string) => unknown = () => undefined) {
    requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
      const p = String(path);
      const custom = overrides(p, opts?.method);
      if (custom !== undefined) return custom;
      if (p.endsWith("/me")) {
        return Promise.resolve({ membership: { user_id: "u-host", role: "owner", source: "membership" } });
      }
      if (p.endsWith("/members")) {
        return Promise.resolve({
          members: [
            { workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" },
            { workspace_id: "w1", user_id: "u-guest", role: "member", email: "g@x.com", display_name: "Lan Anh" },
          ],
        });
      }
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      if (p.endsWith("/participants")) {
        return Promise.resolve({
          participants: [
            { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", display_name_snapshot: "Me", role: "HOST", status: "ACTIVE" },
            { id: "p-guest", meeting_id: "m1", principal_type: "USER", user_id: "u-guest", display_name_snapshot: "Lan Anh", role: "ATTENDEE", status: "ACTIVE" },
          ],
        });
      }
      if (p.endsWith("/join-requests")) return Promise.resolve({ join_requests: [] });
      if (p.endsWith("/invite-links")) {
        return Promise.resolve({
          invite_links: [
            { id: "l1", meeting_id: "m1", name: "Đối tác", access_mode: "AUTO_ADMIT", expires_at: new Date(Date.now() + 86_400_000).toISOString(), used_count: 0 },
          ],
        });
      }
      if (p.endsWith("/activity")) return Promise.resolve({ activity: [] });
      return Promise.resolve({});
    });
  }

  it("asks before removing an attendee", async () => {
    rosterMock();
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));

    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Lan Anh" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Gỡ" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Gỡ Lan Anh khỏi cuộc họp?")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/participants/p-guest", expect.anything());

    fireEvent.click(within(dialog).getByRole("button", { name: "Gỡ khỏi cuộc họp" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants/p-guest", expect.objectContaining({ method: "DELETE" })),
    );
  });

  it("asks before revoking a guest link", async () => {
    rosterMock();
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));

    fireEvent.click(await screen.findByRole("button", { name: "Thu hồi" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/^Thu hồi liên kết "Đối tác/)).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/invite-links/l1/revoke", expect.anything());

    fireEvent.click(within(dialog).getByRole("button", { name: "Thu hồi liên kết" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/invite-links/l1/revoke", expect.objectContaining({ method: "POST" })),
    );
  });

  it("keeps the cancel confirmation open when cancelling fails", async () => {
    rosterMock((p, method) =>
      p === "/api/v1/meetings/m1/cancel" && method === "POST" ? Promise.reject(new ApiError("không huỷ được", "invalid_meeting_state", 409)) : undefined,
    );
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));

    fireEvent.click(await screen.findByRole("button", { name: "Hủy cuộc họp" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Hủy cuộc họp|Hủy cuộc họp/ }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/cancel", expect.anything()));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("hides start and join after the scheduled window ends", async () => {
    const expired = {
      ...meeting,
      starts_at: "2026-08-28T02:00:00Z",
      ends_at: "2026-08-28T02:30:00Z",
    };
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/me")) {
        return Promise.resolve({ membership: { user_id: "u-host", role: "owner", source: "membership" } });
      }
      if (p.endsWith("/members")) {
        return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" }] });
      }
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting: expired });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      if (p.endsWith("/participants")) return Promise.resolve({ participants: [] });
      if (p.endsWith("/join-requests")) return Promise.resolve({ join_requests: [] });
      if (p.endsWith("/invite-links")) return Promise.resolve({ invite_links: [] });
      if (p.endsWith("/activity")) return Promise.resolve({ activity: [] });
      return Promise.resolve({});
    });
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));
    expect(await screen.findByRole("heading", { name: "Standup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bắt đầu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vào phòng họp" })).not.toBeInTheDocument();
    expect(screen.getByText("Không diễn ra")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hủy cuộc họp" })).toBeInTheDocument();
  });

  it("shows three RSVP actions for a pending invitee", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/me")) {
        return Promise.resolve({ membership: { user_id: "u-host", role: "member", source: "membership" } });
      }
      if (p.endsWith("/members")) {
        return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u-host", role: "member", email: "me@x.com", display_name: "Me" }] });
      }
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting: { ...meeting, host_user_id: "other" } });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/invitations")) {
        return Promise.resolve({ invitations: [{ id: "inv1", meeting_id: "m1", participant_id: "p1", response_status: "PENDING" }] });
      }
      if (p.endsWith("/participants")) {
        return Promise.resolve({
          participants: [{ id: "p1", meeting_id: "m1", principal_type: "USER", user_id: "u-host", role: "ATTENDEE", status: "ACTIVE" }],
        });
      }
      if (p.endsWith("/join-requests")) return Promise.resolve({ join_requests: [] });
      if (p.endsWith("/activity")) return Promise.resolve({ activity: [] });
      return Promise.resolve({});
    });
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));
    expect(await screen.findByRole("button", { name: "Tham dự" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chưa chắc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeInTheDocument();
  });

  it("shows the page skeleton, not a blank body, while the meeting loads", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
  });

  it("confirms a cancel with a toast before leaving", async () => {
    const success = vi.spyOn(toast, "success");
    const onDeleted = vi.fn();
    rosterMock((p, method) => (p === "/api/v1/meetings/m1/cancel" && method === "POST" ? Promise.resolve({}) : undefined));
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={onDeleted} />));

    fireEvent.click(await screen.findByRole("button", { name: "Hủy cuộc họp" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Hủy cuộc họp/ }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(success).toHaveBeenCalledWith("Đã hủy cuộc họp");
    success.mockRestore();
  });

  it("lists who is in ahead of notes in reading order, for small screens", async () => {
    rosterMock();
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));
    const roster = await screen.findByRole("heading", { name: /Người tham dự/ });
    const notes = screen.getByRole("heading", { name: "Ghi chú" });
    const rosterSlot = roster.closest(".order-2");
    const notesSlot = notes.closest(".order-3");
    expect(rosterSlot).not.toBeNull();
    expect(notesSlot).not.toBeNull();
  });

  it("hides roster and invite-link mutations after the meeting has ended", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/me")) {
        return Promise.resolve({ membership: { user_id: "u-host", role: "owner", source: "membership" } });
      }
      if (p.endsWith("/members")) {
        return Promise.resolve({
          members: [
            { workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" },
            { workspace_id: "w1", user_id: "u-guest", role: "member", email: "g@x.com", display_name: "user test 01" },
          ],
        });
      }
      if (p === "/api/v1/meetings/m1") {
        return Promise.resolve({
          meeting: { ...meeting, status: "ENDED", actual_end_at: "2026-09-09T08:27:00Z" },
        });
      }
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      if (p.endsWith("/participants")) {
        return Promise.resolve({
          participants: [
            {
              id: "p-host",
              meeting_id: "m1",
              principal_type: "USER",
              user_id: "u-host",
              display_name_snapshot: "admin",
              role: "HOST",
              status: "ACTIVE",
            },
            {
              id: "p-guest",
              meeting_id: "m1",
              principal_type: "USER",
              user_id: "u-guest",
              display_name_snapshot: "user test 01",
              role: "ATTENDEE",
              status: "ACTIVE",
            },
          ],
        });
      }
      if (p.endsWith("/join-requests")) return Promise.resolve({ join_requests: [] });
      if (p.endsWith("/invite-links")) return Promise.resolve({ invite_links: [] });
      if (p.endsWith("/activity")) return Promise.resolve({ activity: [] });
      return Promise.resolve({});
    });
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));
    expect(await screen.findByRole("heading", { name: "Standup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thao tác với/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạo liên kết mới" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chuyển chủ trì" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Nhấn «Tạo liên kết mới»/)).not.toBeInTheDocument();
    expect(screen.queryByText("Khách bên ngoài (không cần tài khoản)")).not.toBeInTheDocument();
  });
});

describe("MeetingsPageView", () => {
  it("shows status badges from the server list", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("/meeting-statistics")) {
        return Promise.resolve({ total: 2, scheduled: 1, in_progress: 1, ended: 0, canceled: 0 });
      }
      if (p.includes("/meetings")) {
        return Promise.resolve({
          meetings: [
            { ...meeting, id: "m1", title: "Standup", status: "SCHEDULED" },
            {
              ...meeting,
              id: "m2",
              title: "Retro",
              status: "IN_PROGRESS",
              starts_at: new Date(Date.now() + 60_000).toISOString(),
              ends_at: new Date(Date.now() + 3_600_000).toISOString(),
            },
          ],
          total: 2,
        });
      }
      if (p.endsWith("/members")) {
        return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" }] });
      }
      return Promise.resolve({});
    });
    render(shell(<MeetingsPageView workspaceId="w1" onOpen={() => {}} onOpenRoom={() => {}} />));
    const rows = await screen.findAllByRole("listitem");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const standupRow = rows.find((row) => within(row).queryByText("Standup"));
    const retroRow = rows.find((row) => within(row).queryByText("Retro"));
    expect(within(standupRow!).getByText("Đã lên lịch")).toBeInTheDocument();
    expect(within(retroRow!).getByRole("button", { name: "Vào ngay" })).toBeInTheDocument();
    expect(within(standupRow!).getByRole("link")).toHaveAttribute("href", "/org/team/meetings/m1");
  });
});

describe("MeetingRoomView", () => {
  it("shows the pre-join screen first and requests admission only after joining", async () => {
    requestMock.mockResolvedValue({ decision: "ADMIT", participant_token: "tok", server_url: "wss://lk.test" });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    expect(screen.getByTestId("meeting-prejoin")).toBeInTheDocument();
    expect(requestMock.mock.calls.some((c) => String(c[0]).endsWith("/join"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Camera", pressed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    await screen.findByTestId("livekit-room");
    expect(lastLiveKitMedia).toEqual({ video: false, audio: true });
  });

  it("shows waiting-for-host and does not mount LiveKit when admission does not admit", async () => {
    requestMock.mockResolvedValue({ decision: "WAITING_FOR_HOST", reason: "MEETING_NOT_STARTED", meeting_status: "SCHEDULED" });
    render(shell(<MeetingRoomView meetingId="m1" onLeave={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    await waitFor(() => expect(screen.getByText("Đang chờ người chủ trì bắt đầu cuộc họp")).toBeInTheDocument());
    expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
  });

  it("mounts LiveKit only after ADMIT with token and url", async () => {
    requestMock.mockResolvedValue({
      decision: "ADMIT",
      participant_token: "tok",
      server_url: "wss://lk.test",
      meeting_status: "IN_PROGRESS",
    });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    expect(await screen.findByTestId("livekit-room")).toBeInTheDocument();
    expect(screen.getByTestId("meeting-stage")).toHaveClass("fixed", "inset-0", "overflow-hidden");
    expect(lastLiveKitMedia).toEqual({ video: true, audio: true });
  });

  it("does not leave the page when LiveKit fails to connect", async () => {
    const onLeave = vi.fn();
    requestMock.mockResolvedValue({
      decision: "ADMIT",
      participant_token: "tok",
      server_url: "wss://lk.test",
      meeting_status: "IN_PROGRESS",
    });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={onLeave} />));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    await screen.findByTestId("livekit-room");
    lastDisconnected?.(DisconnectReason.JOIN_FAILURE);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("does not leave the page on a local disconnect", async () => {
    const onLeave = vi.fn();
    requestMock.mockResolvedValue({
      decision: "ADMIT",
      participant_token: "tok",
      server_url: "wss://lk.test",
      meeting_status: "IN_PROGRESS",
    });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={onLeave} />));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    await screen.findByTestId("livekit-room");
    lastDisconnected?.(DisconnectReason.CLIENT_INITIATED);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("leaves when the conference room is closed", async () => {
    const onLeave = vi.fn();
    requestMock.mockResolvedValue({
      decision: "ADMIT",
      participant_token: "tok",
      server_url: "wss://lk.test",
      meeting_status: "IN_PROGRESS",
    });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={onLeave} />));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    await screen.findByTestId("livekit-room");
    act(() => lastDisconnected?.(DisconnectReason.ROOM_CLOSED));
    // The room says why it closed before sending anyone away.
    expect(await screen.findByRole("heading", { name: "Cuộc họp đã kết thúc" })).toBeInTheDocument();
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Về trang cuộc họp" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("tells a removed participant they were removed", async () => {
    requestMock.mockResolvedValue({
      decision: "ADMIT",
      participant_token: "tok",
      server_url: "wss://lk.test",
      meeting_status: "IN_PROGRESS",
    });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    await screen.findByTestId("livekit-room");
    act(() => lastDisconnected?.(DisconnectReason.PARTICIPANT_REMOVED));
    expect(await screen.findByRole("heading", { name: "Người chủ trì đã mời bạn ra khỏi cuộc họp" })).toBeInTheDocument();
  });

  it("uses the guest prejoin choice when already admitted", async () => {
    render(
      shell(
        <MeetingRoomView
          meetingId="m1"
          workspaceId="w1"
          initialJoinDecision={{
            decision: "ADMIT",
            participant_token: "tok",
            server_url: "wss://lk.test",
          }}
          initialChoice={{ audio: true, video: false }}
          onLeave={() => {}}
        />,
      ),
    );
    expect(screen.queryByTestId("meeting-prejoin")).not.toBeInTheDocument();
    expect(await screen.findByTestId("livekit-room")).toBeInTheDocument();
    expect(lastLiveKitMedia).toEqual({ video: false, audio: true });
  });
});
