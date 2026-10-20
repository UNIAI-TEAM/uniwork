import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatActiveCallBar } from "./chat-active-call-bar";

const call = vi.fn();
vi.mock("./chat-voice-call-host", () => ({ useChatVoiceCall: () => call() }));

beforeAll(() => {
  initI18n();
});

const expandCall = vi.fn();
const hangUp = vi.fn();
const active = {
  status: "active",
  callId: "c1",
  roomId: "r1",
  peerName: "Đội Thiết kế",
  token: "t",
  url: "wss://lk",
  outgoing: true,
  callKind: "group",
};

beforeEach(() => {
  expandCall.mockReset();
  hangUp.mockReset();
});

describe("ChatActiveCallBar", () => {
  it("stays away while the call panel is open", () => {
    call.mockReturnValue({ voiceCall: active, panelMode: "expanded", expandCall, hangUp });
    const { container } = render(<ChatActiveCallBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says who the folded call is with, brings the panel back, and hangs up", () => {
    call.mockReturnValue({ voiceCall: active, panelMode: "minimized", expandCall, hangUp });
    render(<ChatActiveCallBar />);
    const bar = screen.getByRole("region", { name: "Cuộc gọi với Đội Thiết kế · Đã kết nối" });
    expect(bar).toHaveTextContent("Đội Thiết kế· Đã kết nối");
    fireEvent.click(screen.getByRole("button", { name: "Mở rộng cuộc gọi" }));
    expect(expandCall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Rời cuộc gọi" }));
    expect(hangUp).toHaveBeenCalledTimes(1);
  });

  it("is gone once the call has ended", () => {
    call.mockReturnValue({ voiceCall: { status: "idle" }, panelMode: "minimized", expandCall, hangUp });
    const { container } = render(<ChatActiveCallBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
