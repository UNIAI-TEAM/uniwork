import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { ActiveVoiceCallSession } from "./voice-call-overlay-session";
import { PreConnectFloatingCall } from "./voice-call-pre-connect";
import type { VoiceCallConnectionState } from "./voice-call-room-context";

const actions = {
  toggleMute: vi.fn().mockResolvedValue(true),
  toggleCamera: vi.fn().mockResolvedValue(true),
  toggleScreenShare: vi.fn().mockResolvedValue(true),
  unlockAudio: vi.fn().mockResolvedValue(true),
  retryConnection: vi.fn(),
};

let status: {
  connectionState: VoiceCallConnectionState;
  connected: boolean;
  remoteParticipantCount: number;
  needsAudioUnlock: boolean;
  muted: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  deviceError: null;
};

vi.mock("./voice-call-room", () => ({
  VoiceCallRoom: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./voice-call-room-context", () => ({
  useVoiceCallStatus: () => status,
  useVoiceCallActions: () => actions,
  useVoiceCallMedia: () => ({
    participantTiles: [],
    remoteCameraEnabled: false,
    remoteScreenShareEnabled: false,
    bindLocalVideo: vi.fn(),
    bindRemoteVideo: vi.fn(),
    bindLocalScreenShare: vi.fn(),
    bindRemoteScreenShare: vi.fn(),
    bindParticipantVideo: vi.fn(),
    bindParticipantScreenShare: vi.fn(),
  }),
}));

vi.mock("./use-call-duration", () => ({
  useCallDuration: () => 12,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const wsHandlers = new Map<string, (payload: unknown) => void>();
vi.mock("@uniwork/core/realtime", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/realtime")>()),
  useOptionalWS: () => ({
    client: {
      on: (event: string, handler: (payload: unknown) => void) => {
        wsHandlers.set(event, handler);
        return () => wsHandlers.delete(event);
      },
      onReconnect: () => () => undefined,
    },
  }),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  status = {
    connectionState: "connected",
    connected: true,
    remoteParticipantCount: 1,
    needsAudioUnlock: false,
    muted: false,
    cameraEnabled: false,
    screenShareEnabled: false,
    deviceError: null,
  };
  wsHandlers.clear();
  vi.mocked(toast.warning).mockReset();
  requestMock.mockReset();
  requestMock.mockResolvedValue(undefined);
  for (const fn of Object.values(actions)) fn.mockClear();
});

const handlers = () => ({
  onMinimize: vi.fn(),
  onMaximize: vi.fn(),
  onLeave: vi.fn(),
  onDisconnected: vi.fn(),
  onEndForAll: vi.fn(),
  onConnected: vi.fn(),
  onConnectFailed: vi.fn(),
});

function renderSession(
  overrides: Partial<React.ComponentProps<typeof ActiveVoiceCallSession>> = {},
  h = handlers(),
) {
  render(
    wrap(
      <ActiveVoiceCallSession
        workspaceId="ws1"
        roomId="room1"
        callId="call1"
        peerName="Long"
        callKind="dm"
        isCaller
        url="wss://livekit"
        token="tok"
        panelMode="expanded"
        {...h}
        {...overrides}
      />,
    ),
  );
  return h;
}

describe("PreConnectFloatingCall", () => {
  it("renders peer name and child controls", () => {
    render(
      wrap(
        <PreConnectFloatingCall peerName="Long" statusLabel="Calling…" pulse>
          <button type="button">End</button>
        </PreConnectFloatingCall>,
      ),
    );

    expect(screen.getByText("Long")).toBeInTheDocument();
    expect(screen.getByText("Calling…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End" })).toBeInTheDocument();
  });

  it("focuses the incoming alert itself, so Enter or Space cannot answer by accident", () => {
    const onAccept = vi.fn();
    render(
      wrap(
        <PreConnectFloatingCall peerName="Long" statusLabel="Cuộc gọi đến" alert>
          <button type="button">Từ chối</button>
          <button type="button" onClick={onAccept}>
            Nghe máy
          </button>
        </PreConnectFloatingCall>,
      ),
    );

    const dialog = screen.getByRole("alertdialog", { name: "Long" });
    expect(dialog).toHaveFocus();
    expect(screen.getByRole("button", { name: "Nghe máy" })).not.toHaveFocus();
    // @testing-library/user-event is not a dependency here; a keydown on the
    // focused element is what a stray Enter would deliver.
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("keeps a single live region holding only the status line", () => {
    const { container } = render(
      wrap(
        <PreConnectFloatingCall peerName="Long" statusLabel="Đang gọi…">
          <button type="button">End</button>
        </PreConnectFloatingCall>,
      ),
    );
    const live = container.querySelectorAll('[role="status"], [aria-live="polite"], [aria-live="assertive"]');
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent("Đang gọi…");
  });
});

describe("ActiveVoiceCallSession", () => {
  it("renders connected dm controls and keeps the timer out of the live region", () => {
    const h = renderSession();

    expect(h.onConnected).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Micro"));
    expect(actions.toggleMute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Camera"));
    expect(actions.toggleCamera).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Chia sẻ màn hình"));
    expect(actions.toggleScreenShare).toHaveBeenCalledTimes(1);

    const timer = screen.getByRole("timer");
    expect(timer).toHaveAttribute("aria-live", "off");
    expect(timer).toHaveTextContent("0:12");
    expect(screen.getByText("Đã kết nối")).toHaveAttribute("role", "status");
    expect(screen.getByText("Đã kết nối")).not.toHaveTextContent("0:12");
    expect(screen.getByRole("region", { name: /Cuộc gọi với Long/ })).toBeInTheDocument();
  });

  it("exposes the mute shortcut on the mic control", () => {
    renderSession();
    expect(screen.getByLabelText("Micro")).toHaveAttribute("aria-keyshortcuts", "Control+D Meta+D");
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(actions.toggleMute).toHaveBeenCalledTimes(1);
  });

  it("does not call a 1-1 call connected while the other person is not in the room", () => {
    status.remoteParticipantCount = 0;
    const h = renderSession();

    expect(h.onConnected).not.toHaveBeenCalled();
    expect(screen.getByText("Đang chờ Long vào cuộc gọi…")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("shows the recording badge and warns when joining a call already being recorded, even minimised", async () => {
    requestMock.mockImplementation(async (path: string) =>
      path.includes("/voice/recording/active") ? { recording: { id: "rec1", status: "ACTIVE" } } : undefined,
    );
    renderSession({ panelMode: "minimized" });

    expect(await screen.findByTestId("voice-call-rec-indicator")).toHaveTextContent("Đang ghi");
    expect(toast.warning).toHaveBeenCalledWith("Cuộc gọi này đang được ghi âm.");
  });

  it("hears 'someone started recording' while the panel is minimised", async () => {
    renderSession({ panelMode: "minimized" });
    expect(screen.queryByTestId("voice-call-rec-indicator")).not.toBeInTheDocument();

    act(() => {
      wsHandlers.get("chat.voice.recording.started")?.({ room_id: "room1", call_id: "call1", user_id: "peer" });
    });

    expect(await screen.findByTestId("voice-call-rec-indicator")).toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalledWith("Một người trong cuộc gọi vừa bắt đầu ghi âm.");
  });

  it("asks before ending a group call for everyone", async () => {
    const h = renderSession({ callKind: "group", peerName: "Team" });

    fireEvent.click(screen.getByRole("button", { name: "Kết thúc cho mọi người" }));
    expect(h.onEndForAll).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Kết thúc cho mọi người" }));
    expect(h.onEndForAll).toHaveBeenCalledTimes(1);
  });

  it("offers reconnect or leave when the connection is lost, instead of hanging up", () => {
    status.connectionState = "lost";
    status.connected = false;
    const h = renderSession();

    expect(screen.getAllByText("Mất kết nối với cuộc gọi.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối lại" }));
    expect(actions.retryConnection).toHaveBeenCalledTimes(1);
    expect(h.onEndForAll).not.toHaveBeenCalled();
  });

  it("opens fullscreen as a modal dialog that Escape only shrinks", async () => {
    const h = renderSession({ panelMode: "fullscreen" });

    const dialog = await screen.findByRole("dialog", { name: "Long" });
    await waitFor(() => expect(within(dialog).getByLabelText("Thu về cửa sổ")).toHaveFocus());
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    expect(h.onMinimize).toHaveBeenCalledTimes(1);
    expect(h.onEndForAll).not.toHaveBeenCalled();
    expect(h.onLeave).not.toHaveBeenCalled();
  });
});
