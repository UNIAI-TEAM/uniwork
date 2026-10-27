import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { DisconnectReason } from "livekit-client";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import type { RoomExit } from "./exit/exit-model";
import { MeetingRoomView } from "./room-view";

type RoomProps = {
  children: ReactNode;
  onDisconnected?: (reason?: DisconnectReason) => void;
  audio?: unknown;
  video?: unknown;
};

const room = vi.hoisted(() => ({ props: null as null | RoomProps, mounts: 0 }));

vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: function LiveKitRoom(props: RoomProps) {
    room.props = props;
    useEffect(() => {
      room.mounts += 1;
    }, []);
    return <div data-testid="livekit-room">{props.children}</div>;
  },
  useRoomContext: () => ({ remoteParticipants: new Map(), on: vi.fn(), off: vi.fn() }),
}));
vi.mock("./meeting-proactive-token-refresh", () => ({ MeetingProactiveTokenRefresh: () => null }));
vi.mock("./meeting-conference", () => ({
  MeetingConference: ({ onExit, onEndForAll }: { onExit: (exit: RoomExit) => void; onEndForAll?: () => void }) => (
    <>
      <button type="button" onClick={() => onExit({ kind: "left", media: { audio: true, video: false } })}>
        leave-room
      </button>
      <button type="button" onClick={() => onEndForAll?.()}>
        end-for-all
      </button>
    </>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

const me: User = {
  id: "u-me",
  email: "me@x.com",
  display_name: "Me",
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
  status: "IN_PROGRESS",
  host_user_id: "u-host",
  room_name: "uw_mtg_m1",
  created_by: "u-host",
};
const person = (id: string, name: string, inRoom: boolean) => ({
  id, meeting_id: "m1", principal_type: "USER", user_id: `u-${id}`, display_name_snapshot: name,
  role: "ATTENDEE", status: "ACTIVE", in_room: inRoom,
});

let status = "IN_PROGRESS";
let joins = 0;

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  room.props = null;
  room.mounts = 0;
  status = "IN_PROGRESS";
  joins = 0;
  endAnswer = () => Promise.resolve({ meeting: { ...meeting, status: "ENDED" } });
  vi.mocked(toast.error).mockClear();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/join")) {
      joins += 1;
      return Promise.resolve({ decision: "ADMIT", server_url: "wss://lk.test", participant_token: `tok-${joins}` });
    }
    if (path.endsWith("/participants")) {
      return Promise.resolve({
        participants: [person("me", "Me", false), person("lan", "Hoàng Lan", true), person("quan", "Bùi Minh Quân", true)],
      });
    }
    if (path.endsWith("/meetings/m1")) return Promise.resolve({ meeting: { ...meeting, status } });
    if (path.endsWith("/meetings/m1/end")) return endAnswer();
    return Promise.resolve({});
  });
});

let endAnswer: () => Promise<unknown> = () => Promise.resolve({ meeting: { ...meeting, status: "ENDED" } });

function renderRoom(onLeave = vi.fn(), onEnded?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    wrapWithNav(
      <MeetingRoomView
        meetingId="m1"
        workspaceId="w1"
        initialChoice={{ audio: true, video: true }}
        onLeave={onLeave}
        onEnded={onEnded}
      />,
      fakeNav(),
      client,
    ),
  );
  return { client, onLeave };
}

async function leave() {
  fireEvent.click(await screen.findByRole("button", { name: "leave-room" }));
  // Unmounting LiveKitRoom disconnects it; that is not a lost connection.
  act(() => room.props?.onDisconnected?.(DisconnectReason.CLIENT_INITIATED));
}

describe("MeetingRoomView leave screen", () => {
  it("stays on the room route with a leave screen: who is still in, the devices it will rejoin with", async () => {
    renderRoom();
    await leave();
    expect(await screen.findByRole("heading", { name: "Bạn đã rời phòng" })).toBeInTheDocument();
    expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vào lại" })).toBeInTheDocument();
    expect(screen.getByText("Mic bật")).toBeInTheDocument();
    expect(screen.getByText("Camera tắt")).toBeInTheDocument();
    expect(await screen.findByText("2 người vẫn đang họp")).toBeInTheDocument();
  });

  it("rejoins without the prejoin, with the devices as they were on leaving, and no connection error", async () => {
    renderRoom();
    await leave();
    fireEvent.click(await screen.findByRole("button", { name: "Vào lại" }));
    await waitFor(() => expect(joins).toBe(2));
    expect(await screen.findByTestId("livekit-room")).toBeInTheDocument();
    expect(room.props?.audio).toBe(true);
    expect(room.props?.video).toBe(false);
    expect(screen.queryByText("Không kết nối được cuộc họp")).not.toBeInTheDocument();
  });

  it("turns into the ended screen when the meeting ends while the viewer is out", async () => {
    const { client } = renderRoom();
    await leave();
    await screen.findByRole("heading", { name: "Bạn đã rời phòng" });
    status = "ENDED";
    await act(() => client.invalidateQueries({ queryKey: ["meeting", "m1"] }));
    expect(await screen.findByRole("heading", { name: "Cuộc họp đã kết thúc" })).toBeInTheDocument();
  });

  it("goes back to the meeting page only when asked", async () => {
    const { onLeave } = renderRoom();
    await leave();
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Về trang cuộc họp" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("covers the room with the logo while ending for everyone, then hands off", async () => {
    let finish: (value: unknown) => void = () => {};
    endAnswer = () => new Promise((resolve) => (finish = resolve));
    const onEnded = vi.fn();
    renderRoom(vi.fn(), onEnded);
    fireEvent.click(await screen.findByRole("button", { name: "end-for-all" }));
    expect(await screen.findByText("Đang kết thúc cuộc họp…")).toBeInTheDocument();
    expect(onEnded).not.toHaveBeenCalled();
    await act(async () => finish({ meeting: { ...meeting, status: "ENDED" } }));
    await waitFor(() => expect(onEnded).toHaveBeenCalledOnce());
  });

  it("lifts the cover and keeps the room when ending fails", async () => {
    endAnswer = () => Promise.reject(new ApiError("boom", "internal", 500));
    const onEnded = vi.fn();
    renderRoom(vi.fn(), onEnded);
    fireEvent.click(await screen.findByRole("button", { name: "end-for-all" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText("Đang kết thúc cuộc họp…")).not.toBeInTheDocument();
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
    expect(onEnded).not.toHaveBeenCalled();
  });
});
