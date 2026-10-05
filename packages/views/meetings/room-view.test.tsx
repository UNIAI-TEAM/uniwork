import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { DisconnectReason, MediaDeviceFailure } from "livekit-client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomView } from "./room-view";

type RoomProps = {
  children: ReactNode;
  onError?: (error: Error) => void;
  onMediaDeviceFailure?: (failure?: MediaDeviceFailure, kind?: MediaDeviceKind) => void;
  onDisconnected?: (reason?: DisconnectReason) => void;
  token?: string;
};

const meetingScope = vi.hoisted(() => ({ held: [] as string[] }));
vi.mock("@uniwork/core/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/realtime")>();
  return {
    ...actual,
    useMeetingScope: (meetingId: string) => {
      meetingScope.held.push(meetingId);
      actual.useMeetingScope(meetingId);
    },
  };
});

const room = vi.hoisted(() => ({
  props: null as null | RoomProps,
  micOn: false,
  mounts: 0,
  onRefresh: null as null | (() => Promise<{ token: string } | null>),
}));

vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: function LiveKitRoom(props: RoomProps) {
    room.props = props;
    useEffect(() => {
      room.mounts += 1;
    }, []);
    return <div data-testid="livekit-room">{props.children}</div>;
  },
  useLocalParticipant: () => ({
    localParticipant: { setMicrophoneEnabled: vi.fn(), setCameraEnabled: vi.fn() },
    isMicrophoneEnabled: room.micOn,
    isCameraEnabled: false,
  }),
}));
vi.mock("./meeting-proactive-token-refresh", () => ({
  MeetingProactiveTokenRefresh: ({ onRefresh }: { onRefresh: () => Promise<{ token: string } | null> }) => {
    room.onRefresh = onRefresh;
    return null;
  },
}));
vi.mock("./meeting-conference", () => ({
  MeetingConference: ({ deviceNotice }: { deviceNotice?: ReactNode }) => (
    <div data-testid="conference">{deviceNotice}</div>
  ),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  meetingScope.held = [];
  room.props = null;
  room.micOn = false;
  room.mounts = 0;
  room.onRefresh = null;
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});

function renderRoom() {
  render(
    wrapWithNav(
      <MeetingRoomView
        meetingId="m1"
        workspaceId="w1"
        guestMode
        meetingTitle="Standup"
        initialJoinDecision={{ decision: "ADMIT", server_url: "wss://lk.test", participant_token: "tok" }}
        initialChoice={{ audio: true, video: true }}
        onLeave={() => {}}
      />,
    ),
  );
}

function namedError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe("MeetingRoomView media failures", () => {
  it("keeps the viewer in the room when the microphone is blocked, with a notice and a retry", () => {
    renderRoom();
    act(() => {
      room.props?.onMediaDeviceFailure?.(MediaDeviceFailure.PermissionDenied, "audioinput");
      room.props?.onError?.(namedError("NotAllowedError"));
    });
    expect(screen.getByTestId("conference")).toBeInTheDocument();
    expect(screen.queryByText("Không kết nối được cuộc họp")).not.toBeInTheDocument();
    expect(screen.getByText(/Trình duyệt đang chặn mic/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bật lại mic" })).toBeInTheDocument();
  });

  it("names a busy camera", () => {
    renderRoom();
    act(() => {
      room.props?.onMediaDeviceFailure?.(MediaDeviceFailure.DeviceInUse, "videoinput");
      room.props?.onError?.(namedError("NotReadableError"));
    });
    expect(screen.getByText(/Camera đang được ứng dụng khác dùng/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bật lại camera" })).toBeInTheDocument();
  });

  it("drops the notice once the microphone is on again", () => {
    room.micOn = true;
    renderRoom();
    act(() => room.props?.onMediaDeviceFailure?.(MediaDeviceFailure.NotFound, "audioinput"));
    expect(screen.queryByTestId("meeting-device-notice")).not.toBeInTheDocument();
  });

  it("ignores a cancelled screen-share picker", () => {
    renderRoom();
    act(() => room.props?.onMediaDeviceFailure?.(MediaDeviceFailure.PermissionDenied, undefined));
    expect(screen.queryByTestId("meeting-device-notice")).not.toBeInTheDocument();
  });

  it("still sends a real connection failure to the connection screen", () => {
    renderRoom();
    act(() => room.props?.onError?.(namedError("ConnectionError")));
    expect(screen.queryByTestId("conference")).not.toBeInTheDocument();
    expect(screen.getByText("Không kết nối được cuộc họp")).toBeInTheDocument();
  });
});

describe("MeetingRoomView credential refresh", () => {
  it("keeps the room connected while the LiveKit token refreshes", async () => {
    let finishRefresh: null | ((value: unknown) => void) = null;
    requestMock.mockImplementation((path: string) => {
      if (!path.endsWith("/join")) return Promise.resolve({});
      if (room.mounts === 0) {
        return Promise.resolve({ decision: "ADMIT", server_url: "wss://lk.test", participant_token: "tok-1" });
      }
      return new Promise((resolve) => {
        finishRefresh = resolve;
      });
    });
    render(
      wrapWithNav(
        <MeetingRoomView
          meetingId="m1"
          workspaceId="w1"
          guestMode
          meetingTitle="Standup"
          initialChoice={{ audio: false, video: false }}
          onLeave={() => {}}
        />,
      ),
    );
    await screen.findByTestId("livekit-room");
    expect(room.mounts).toBe(1);

    let refreshed: Promise<{ token: string } | null> = Promise.resolve(null);
    act(() => {
      refreshed = room.onRefresh!();
    });
    await waitFor(() => expect(finishRefresh).not.toBeNull());
    // Unmounting LiveKitRoom disconnects the room and drops a screen share.
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();

    await act(async () => {
      finishRefresh!({ decision: "ADMIT", server_url: "wss://lk.test", participant_token: "tok-2" });
      await expect(refreshed).resolves.toMatchObject({ token: "tok-2" });
    });
    await waitFor(() => expect(screen.getByTestId("livekit-room")).toBeInTheDocument());
    expect(room.mounts).toBe(1);
    // The new token is patched into the engine; a new prop would call room.connect again.
    expect(room.props?.token).toBe("tok-1");
  });

  it("re-joins a dropped room in place instead of tearing the stage down", async () => {
    let finishRejoin: null | ((value: unknown) => void) = null;
    requestMock.mockImplementation((path: string) => {
      if (!path.endsWith("/join")) return Promise.resolve({});
      if (room.mounts === 0) {
        return Promise.resolve({ decision: "ADMIT", server_url: "wss://lk.test", participant_token: "tok-1" });
      }
      return new Promise((resolve) => {
        finishRejoin = resolve;
      });
    });
    render(
      wrapWithNav(
        <MeetingRoomView
          meetingId="m1"
          workspaceId="w1"
          guestMode
          meetingTitle="Standup"
          initialChoice={{ audio: false, video: false }}
          onLeave={() => {}}
        />,
      ),
    );
    await screen.findByTestId("livekit-room");

    act(() => room.props?.onDisconnected?.(DisconnectReason.SIGNAL_CLOSE));
    await waitFor(() => expect(finishRejoin).not.toBeNull());
    expect(screen.getByTestId("conference")).toBeInTheDocument();
    expect(room.props?.token).toBe("tok-1");

    await act(async () => {
      finishRejoin!({ decision: "ADMIT", server_url: "wss://lk.test", participant_token: "tok-2" });
    });
    // The new token reconnects the same Room: LiveKitRoom never unmounted.
    await waitFor(() => expect(room.props?.token).toBe("tok-2"));
    expect(room.mounts).toBe(1);
  });
});

describe("MeetingRoomView lobby for a member", () => {
  it("keeps the waiting lobby through a re-join and still withdraws the knock on leave", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let joins = 0;
      requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
        if (path === "/api/v1/meetings/m1/join" && opts?.method === "POST") {
          joins += 1;
          // The first answer: waiting for approval. The backoff re-ask hangs.
          return joins === 1
            ? Promise.resolve({ decision: "WAITING_APPROVAL", join_request_id: "jr1", meeting_status: "IN_PROGRESS" })
            : new Promise(() => {});
        }
        return Promise.resolve({});
      });

      const view = render(
        wrapWithNav(
          <MeetingRoomView
            meetingId="m1"
            workspaceId="w1"
            meetingTitle="Standup"
            initialChoice={{ audio: false, video: false }}
            onLeave={() => {}}
          />,
        ),
      );

      const heading = await screen.findByRole("heading", { name: "Đang chờ người chủ trì cho bạn vào phòng" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(13_000);
      });
      expect(joins).toBe(2);
      // Still the same lobby, not the "connecting" screen, and focus did not move.
      expect(screen.getByRole("heading", { name: "Đang chờ người chủ trì cho bạn vào phòng" })).toBe(heading);

      view.unmount();
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith("/api/v1/meeting-join-requests/jr1/cancel", expect.objectContaining({ method: "POST" })),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays in the waiting lobby through a 429 and asks again after Retry-After", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let joins = 0;
      requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
        if (path === "/api/v1/meetings/m1/join" && opts?.method === "POST") {
          joins += 1;
          if (joins === 1) {
            return Promise.resolve({ decision: "WAITING_APPROVAL", join_request_id: "jr1", meeting_status: "IN_PROGRESS" });
          }
          if (joins === 2) {
            // The office NAT ran out of /join budget: the backoff re-ask is refused.
            return Promise.reject(
              Object.assign(new ApiError("too many requests", "rate_limited", 429), { retryAfterSeconds: 20 }),
            );
          }
          return new Promise(() => {});
        }
        return Promise.resolve({});
      });

      render(
        wrapWithNav(
          <MeetingRoomView
            meetingId="m1"
            workspaceId="w1"
            meetingTitle="Standup"
            initialChoice={{ audio: false, video: false }}
            onLeave={() => {}}
          />,
        ),
      );

      const heading = await screen.findByRole("heading", { name: "Đang chờ người chủ trì cho bạn vào phòng" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(13_000);
      });
      expect(joins).toBe(2);
      // A rate limit is not a refusal: the same lobby, no error screen.
      expect(screen.getByRole("heading", { name: "Đang chờ người chủ trì cho bạn vào phòng" })).toBe(heading);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_000);
      });
      expect(joins).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(joins).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MeetingRoomView meeting scope", () => {
  it("holds the meeting's realtime scope for a member, from the lobby on", () => {
    render(
      wrapWithNav(
        <MeetingRoomView meetingId="m1" workspaceId="w1" meetingTitle="Standup" onLeave={() => {}} />,
      ),
    );
    expect(meetingScope.held.length).toBeGreaterThan(0);
    expect(new Set(meetingScope.held)).toEqual(new Set(["m1"]));
  });

  it("leaves a guest on the lobby socket", () => {
    renderRoom();
    expect(new Set(meetingScope.held)).toEqual(new Set([""]));
  });
});
