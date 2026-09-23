import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatRealtimeStatusBanner, REALTIME_ANNOUNCE_DELAY_MS } from "./chat-realtime-status-banner";

const reconnectNow = vi.fn();
const connection = { state: "disconnected", hasEverConnected: true, reconnectNow };

vi.mock("@uniwork/core/realtime", () => ({
  useWSConnectionState: () => connection,
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  vi.useFakeTimers();
  connection.state = "disconnected";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChatRealtimeStatusBanner", () => {
  it("shows disconnected copy and the reconnect action at once, and announces it once it holds", () => {
    render(<ChatRealtimeStatusBanner pendingOutboxCount={2} />);

    // The strip is visual; the one status region carries the announcement.
    expect(screen.getByText("Mất kết nối", { exact: false })).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("2 tin nhắn đang chờ gửi");
    expect(status).not.toHaveTextContent("Mất kết nối");

    act(() => {
      vi.advanceTimersByTime(REALTIME_ANNOUNCE_DELAY_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Mất kết nối");

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(reconnectNow).toHaveBeenCalled();
  });

  it("keeps the status region mounted and silent while connected, so a flap never reaches it", () => {
    connection.state = "connected";
    const { rerender } = render(<ChatRealtimeStatusBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("");

    connection.state = "connecting";
    rerender(<ChatRealtimeStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(REALTIME_ANNOUNCE_DELAY_MS / 2);
    });
    connection.state = "connected";
    rerender(<ChatRealtimeStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(REALTIME_ANNOUNCE_DELAY_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("counts pending messages with a plural", () => {
    connection.state = "connected";
    render(<ChatRealtimeStatusBanner pendingOutboxCount={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 tin nhắn đang chờ gửi");
  });
});
