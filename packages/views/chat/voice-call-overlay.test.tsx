import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { VoiceCallOverlay } from "./voice-call-overlay";

vi.mock("./use-call-ringtone", () => ({
  useCallRingtone: vi.fn(),
}));

vi.mock("./voice-call-pre-connect", () => ({
  PreConnectFloatingCall: ({
    peerName,
    statusLabel,
    notice,
    children,
  }: {
    peerName: string;
    statusLabel: string;
    notice?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-testid="preconnect">
      <span>{peerName}</span>
      <span>{statusLabel}</span>
      {notice}
      {children}
    </div>
  ),
}));

// The active session arrives through React.lazy, so its assertion waits.
vi.mock("./voice-call-overlay-session", () => ({
  ActiveVoiceCallSession: () => <div data-testid="active-session" />,
}));

beforeAll(() => {
  initI18n();
});

const handlers = {
  onAccept: vi.fn(),
  onDecline: vi.fn(),
  onLeave: vi.fn(),
  onDisconnected: vi.fn(),
  onEndForAll: vi.fn(),
  onConnected: vi.fn(),
  onRetryEnded: vi.fn(),
  onDismissEnded: vi.fn(),
};

const overlayProps = { workspaceId: "ws1", ...handlers };

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
          {...overlayProps}
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
          {...overlayProps}
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
          {...overlayProps}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Rời cuộc gọi"));
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
  });

  it("renders active session shell", async () => {
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
          {...overlayProps}
        />,
      ),
    );

    expect(await screen.findByTestId("active-session")).toBeInTheDocument();
  });

  it("renders no panel while idle, only the empty announcer", () => {
    render(wrap(<VoiceCallOverlay state={{ status: "idle" }} {...overlayProps} />));
    expect(screen.queryByTestId("preconnect")).not.toBeInTheDocument();
    expect(screen.getByTestId("voice-call-ended-announcer")).toBeEmptyDOMElement();
  });

  it("says why a call ended and offers to call back", () => {
    render(
      wrap(
        <VoiceCallOverlay
          state={{
            status: "ended",
            reason: "no_answer",
            callId: "c1",
            roomId: "r1",
            peerName: "Long",
            callKind: "dm",
            outgoing: true,
          }}
          {...overlayProps}
        />,
      ),
    );

    expect(screen.getByTestId("voice-call-ended-announcer")).toHaveTextContent("Không ai nghe máy");
    fireEvent.click(screen.getByLabelText("Gọi lại"));
    expect(handlers.onRetryEnded).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Đóng"));
    expect(handlers.onDismissEnded).toHaveBeenCalledTimes(1);
  });

  it("names the blocked device on an incoming call and lets the viewer retry answering", () => {
    render(
      wrap(
        <VoiceCallOverlay
          state={{ status: "incoming", callId: "c1", roomId: "r1", peerName: "Long", callKind: "dm" }}
          incomingDeviceError={{ kind: "audioinput", failure: "in_use" }}
          {...overlayProps}
        />,
      ),
    );

    expect(screen.getByText("Micro đang được ứng dụng khác dùng.")).toBeInTheDocument();
    expect(screen.getByLabelText("Thử lại")).toBeInTheDocument();
  });
});
