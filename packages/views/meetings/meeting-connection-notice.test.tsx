import { render, screen } from "@testing-library/react";
import { ConnectionState } from "livekit-client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { connectionNotice, MeetingConnectionNotice } from "./meeting-connection-notice";

const livekit = vi.hoisted(() => ({ state: "connected" as string }));

vi.mock("@livekit/components-react", () => ({
  useConnectionState: () => livekit.state,
}));

beforeAll(() => {
  initI18n();
});

describe("connectionNotice", () => {
  it("says nothing before the first connection: joining is not a lost connection", () => {
    expect(connectionNotice(ConnectionState.Connecting, false)).toBeNull();
    expect(connectionNotice(ConnectionState.Disconnected, false)).toBeNull();
  });

  it("reports reconnecting as a warning once the room has been connected", () => {
    expect(connectionNotice(ConnectionState.Reconnecting, true)).toBe("reconnecting");
    expect(connectionNotice(ConnectionState.SignalReconnecting, true)).toBe("reconnecting");
    expect(connectionNotice(ConnectionState.Connecting, true)).toBe("reconnecting");
  });

  it("reports a dropped room as lost, and a healthy room as nothing", () => {
    expect(connectionNotice(ConnectionState.Disconnected, true)).toBe("lost");
    expect(connectionNotice(ConnectionState.Connected, true)).toBeNull();
  });
});

describe("MeetingConnectionNotice", () => {
  it("shows an in-stage strip while the room reconnects, and clears it after", () => {
    livekit.state = ConnectionState.Connected;
    const { rerender } = render(<MeetingConnectionNotice />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    livekit.state = ConnectionState.Reconnecting;
    rerender(<MeetingConnectionNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang kết nối lại…");

    livekit.state = ConnectionState.Disconnected;
    rerender(<MeetingConnectionNotice />);
    expect(screen.getByRole("alert")).toHaveTextContent("Mất kết nối với phòng họp");

    livekit.state = ConnectionState.Connected;
    rerender(<MeetingConnectionNotice />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
