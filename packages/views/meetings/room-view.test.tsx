import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { DisconnectReason, MediaDeviceFailure } from "livekit-client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByText(/Trình duyệt đang chặn micro/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bật lại micro" })).toBeInTheDocument();
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
