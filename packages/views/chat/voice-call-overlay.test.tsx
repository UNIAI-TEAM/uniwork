import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { VoiceCallOverlay } from "./voice-call-overlay";

vi.mock("./use-call-ringtone", () => ({
  useCallRingtone: vi.fn(),
}));

vi.mock("./voice-call-overlay-session", () => ({
  PreConnectFloatingCall: ({
    peerName,
    statusLabel,
    children,
  }: {
    peerName: string;
    statusLabel: string;
    children: React.ReactNode;
  }) => (
    <div data-testid="preconnect">
      <span>{peerName}</span>
      <span>{statusLabel}</span>
      {children}
    </div>
  ),
  ActiveVoiceCallSession: () => <div data-testid="active-session" />,
}));

beforeAll(() => {
  initI18n();
});

const handlers = {
  onAccept: vi.fn(),
  onDecline: vi.fn(),
  onLeave: vi.fn(),
  onEndForAll: vi.fn(),
  onConnected: vi.fn(),
};

describe("VoiceCallOverlay", () => {
  it("renders incoming call actions", () => {
    render(
      wrap(
        <VoiceCallOverlay
          state={{
            status: "incoming",
            callId: "c1",
            roomId: "r1",
            peerName: "Long",
            callKind: "dm",
          }}
          {...handlers}
        />,
      ),
    );

    expect(screen.getByTestId("preconnect")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Từ chối"));
    fireEvent.click(screen.getByLabelText("Nghe máy"));
    expect(handlers.onDecline).toHaveBeenCalledTimes(1);
    expect(handlers.onAccept).toHaveBeenCalledTimes(1);
  });

  it("ends outgoing dm pre-connect via end-for-all handler", () => {
    render(
      wrap(
        <VoiceCallOverlay
          state={{
            status: "ringing",
            callId: "c1",
            roomId: "r1",
            peerName: "Long",
            outgoing: true,
            callKind: "dm",
          }}
          {...handlers}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Kết thúc"));
    expect(handlers.onEndForAll).toHaveBeenCalledTimes(1);
  });

  it("ends outgoing group pre-connect via leave handler", () => {
    render(
      wrap(
        <VoiceCallOverlay
          state={{
            status: "connecting",
            callId: "c1",
            roomId: "r1",
            peerName: "Team",
            outgoing: false,
            callKind: "group",
          }}
          {...handlers}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Rời cuộc gọi"));
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
  });

  it("renders active session shell", () => {
    render(
      wrap(
        <VoiceCallOverlay
          state={{
            status: "active",
            callId: "c1",
            roomId: "r1",
            peerName: "Long",
            token: "tok",
            url: "wss://livekit",
            outgoing: true,
            callKind: "group",
          }}
          {...handlers}
        />,
      ),
    );

    expect(screen.getByTestId("active-session")).toBeInTheDocument();
  });

  it("returns null while idle", () => {
    const { container } = render(
      wrap(<VoiceCallOverlay state={{ status: "idle" }} {...handlers} />),
    );
    expect(container).toBeEmptyDOMElement();
  });
});
