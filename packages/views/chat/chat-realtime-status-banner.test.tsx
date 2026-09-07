import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatRealtimeStatusBanner } from "./chat-realtime-status-banner";

const reconnectNow = vi.fn();

vi.mock("@uniwork/core/realtime", () => ({
  useWSConnectionState: () => ({
    state: "disconnected",
    hasEverConnected: true,
    reconnectNow,
  }),
}));

beforeAll(() => {
  initI18n();
});

describe("ChatRealtimeStatusBanner", () => {
  it("shows disconnected copy and reconnect action", () => {
    render(<ChatRealtimeStatusBanner pendingOutboxCount={2} />);

    expect(screen.getByRole("status")).toHaveTextContent("Mất kết nối thời gian thực");
    expect(screen.getByRole("status")).toHaveTextContent("2 tin nhắn đang chờ gửi");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(reconnectNow).toHaveBeenCalled();
  });
});
