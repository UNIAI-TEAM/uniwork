import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import type { Meeting } from "@uniwork/core/types";
import { wrapWithNav } from "../test/api-mock";
import { MeetingPreJoin } from "./meeting-prejoin";

const meeting: Meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  description: "",
  starts_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  ends_at: new Date(Date.now() + 90 * 60_000).toISOString(),
  room_name: "uw_mtg_m1",
  created_by: "u-host",
  status: "SCHEDULED",
  host_user_id: "u-host",
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([
        { deviceId: "cam1", kind: "videoinput", label: "FaceTime HD" },
        { deviceId: "mic1", kind: "audioinput", label: "Built-in Mic" },
      ]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

describe("MeetingPreJoin", () => {
  it("shows meeting details, device pickers, and join choice", async () => {
    const onJoin = vi.fn();
    render(
      wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={onJoin} onLeave={() => {}} />),
    );

    expect(await screen.findByRole("heading", { name: "Standup" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Micro", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camera", pressed: true })).toBeInTheDocument();
    expect(await screen.findByText("Built-in Mic")).toBeInTheDocument();
    expect(screen.getByText("FaceTime HD")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Micro", pressed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Camera", pressed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));

    expect(onJoin).toHaveBeenCalledWith({
      audio: false,
      video: false,
      audioDeviceId: undefined,
      videoDeviceId: undefined,
    });
  });

  it("falls back to the generic title when meeting metadata is missing", () => {
    render(wrapWithNav(<MeetingPreJoin onJoin={() => {}} onLeave={() => {}} />));
    expect(screen.getByRole("heading", { name: "Cuộc họp" })).toBeInTheDocument();
  });

  it("shows skeleton lines instead of the fallback title while the meeting loads", () => {
    const { container } = render(
      wrapWithNav(<MeetingPreJoin loading onJoin={() => {}} onLeave={() => {}} />),
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText("Cuộc họp")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(2);
  });

  it("styles the eyebrow as an overline", () => {
    render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />));
    expect(screen.getByText("Sẵn sàng vào họp")).toHaveClass("text-overline", "text-muted-foreground");
  });

  it("previews the camera with the saved mirror preference", () => {
    useMeetingRoomPreferencesStore.setState({ mirrorCamera: true });
    const { unmount } = render(
      wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />),
    );
    expect(screen.getByLabelText("Xem trước camera")).toHaveClass("scale-x-[-1]");
    unmount();

    useMeetingRoomPreferencesStore.setState({ mirrorCamera: false });
    render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />));
    expect(screen.getByLabelText("Xem trước camera")).not.toHaveClass("scale-x-[-1]");
  });

  it("keeps the mic field with an explanation before the browser grants access", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: "", kind: "audioinput", label: "" },
          { deviceId: "", kind: "videoinput", label: "" },
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />));
    expect(await screen.findByText("Cho phép micro để chọn thiết bị")).toBeInTheDocument();
    expect(screen.getByText("Cho phép camera để chọn thiết bị")).toBeInTheDocument();
  });

  it("asks for the microphone on its own when the list is empty, then re-lists devices", async () => {
    const stop = vi.fn();
    let granted = false;
    const enumerateDevices = vi.fn(() =>
      Promise.resolve(
        granted
          ? [{ deviceId: "mic1", kind: "audioinput", label: "Built-in Mic" }]
          : [{ deviceId: "", kind: "audioinput", label: "" }],
      ),
    );
    const getUserMedia = vi.fn(() => {
      granted = true;
      return Promise.resolve({ getTracks: () => [{ stop }] });
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices, getUserMedia, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: "Cho phép micro" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    await waitFor(() => expect(stop).toHaveBeenCalled());
    expect(await screen.findByText("Built-in Mic")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Mức âm thanh micro" })).toBeInTheDocument();
  });

  it("says how to unblock the microphone when the browser refuses", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: vi.fn().mockRejectedValue(new DOMException("", "NotAllowedError")),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: "Cho phép micro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trình duyệt đang chặn micro");
  });
});
