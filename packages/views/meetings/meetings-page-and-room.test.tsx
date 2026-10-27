import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
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
    remoteParticipants: new Map(),
    on: vi.fn(),
    off: vi.fn(),
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

  it("tells the host their meeting has not started instead of asking them to wait for themselves", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      // A plain member who hosts this meeting: the start right comes from being its host.
      if (p.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u-host", role: "member", source: "membership" } });
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting });
      if (p.endsWith("/join")) {
        return Promise.resolve({ decision: "WAITING_FOR_HOST", reason: "MEETING_NOT_STARTED", meeting_status: "SCHEDULED" });
      }
      return Promise.resolve({});
    });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: "Vào phòng họp" }));
    expect(await screen.findByRole("heading", { name: "Cuộc họp chưa bắt đầu" })).toBeInTheDocument();
    expect(screen.queryByText("Đang chờ người chủ trì bắt đầu cuộc họp")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bắt đầu" })).toBeInTheDocument();
  });

  it("tells the host when starting the meeting failed", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u-host", role: "member", source: "membership" } });
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting });
      if (p.endsWith("/start")) return Promise.reject(new ApiError("boom", "internal", 500));
      if (p.endsWith("/join")) {
        return Promise.resolve({ decision: "WAITING_FOR_HOST", reason: "MEETING_NOT_STARTED", meeting_status: "SCHEDULED" });
      }
      return Promise.resolve({});
    });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: "Vào phòng họp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bắt đầu" }));
    expect(await screen.findByText("Chưa bắt đầu được cuộc họp. Thử lại.")).toBeInTheDocument();
  });

  it("joins again when someone else started the meeting first", async () => {
    let joins = 0;
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u-host", role: "member", source: "membership" } });
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting });
      if (p.endsWith("/start")) return Promise.reject(new ApiError("already", "invalid_meeting_state", 409));
      if (p.endsWith("/join")) {
        joins += 1;
        return Promise.resolve(
          joins === 1
            ? { decision: "WAITING_FOR_HOST", reason: "MEETING_NOT_STARTED", meeting_status: "SCHEDULED" }
            : { decision: "ADMIT", participant_token: "tok", server_url: "wss://lk.test" },
        );
      }
      return Promise.resolve({});
    });
    render(shell(<MeetingRoomView meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: "Vào phòng họp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bắt đầu" }));
    await screen.findByTestId("livekit-room");
    expect(screen.queryByText("Chưa bắt đầu được cuộc họp. Thử lại.")).not.toBeInTheDocument();
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
    const heading = await screen.findByRole("heading", { name: "Bạn đã được mời ra khỏi phòng" });
    // The room vanished under the pointer: focus lands on why, so a screen
    // reader hears it instead of losing its place on a removed video tile.
    await waitFor(() => expect(heading).toHaveFocus());
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
