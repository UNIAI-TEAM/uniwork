import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ActiveVoiceCallSession } from "./voice-call-overlay-session";
import { PreConnectFloatingCall } from "./voice-call-pre-connect";

const toggleCamera = vi.fn().mockResolvedValue(true);
const toggleMute = vi.fn();

vi.mock("./voice-call-room", () => ({
  VoiceCallRoom: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useVoiceCallRoom: () => ({
    connected: true,
    muted: false,
    cameraEnabled: false,
    remoteCameraEnabled: false,
    remoteParticipantCount: 1,
    needsAudioUnlock: false,
    bindLocalVideo: vi.fn(),
    bindRemoteVideo: vi.fn(),
    toggleMute,
    toggleCamera,
    unlockAudio: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock("./use-call-duration", () => ({
  useCallDuration: () => 12,
}));

beforeAll(() => {
  initI18n();
});

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
});

describe("ActiveVoiceCallSession", () => {
  it("renders connected dm controls", () => {
    const onConnected = vi.fn();
    render(
      wrap(
        <ActiveVoiceCallSession
          peerName="Long"
          callKind="dm"
          isCaller
          url="wss://livekit"
          token="tok"
          panelMode="expanded"
          onMinimize={vi.fn()}
          onMaximize={vi.fn()}
          onLeave={vi.fn()}
          onEndForAll={vi.fn()}
          onConnected={onConnected}
          onConnectFailed={vi.fn()}
        />,
      ),
    );

    expect(onConnected).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Tắt mic"));
    expect(toggleMute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Bật camera"));
    expect(toggleCamera).toHaveBeenCalledTimes(1);
  });
});
