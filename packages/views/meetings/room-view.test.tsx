import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MediaDeviceFailure } from "livekit-client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomView } from "./room-view";

type RoomProps = {
  children: ReactNode;
  onError?: (error: Error) => void;
  onMediaDeviceFailure?: (failure?: MediaDeviceFailure, kind?: MediaDeviceKind) => void;
};

const room = vi.hoisted(() => ({ props: null as null | RoomProps, micOn: false }));

vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: RoomProps) => {
    room.props = props;
    return <div data-testid="livekit-room">{props.children}</div>;
  },
  useLocalParticipant: () => ({
    localParticipant: { setMicrophoneEnabled: vi.fn(), setCameraEnabled: vi.fn() },
    isMicrophoneEnabled: room.micOn,
    isCameraEnabled: false,
  }),
}));
vi.mock("./meeting-proactive-token-refresh", () => ({ MeetingProactiveTokenRefresh: () => null }));
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
