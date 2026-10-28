import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingPreJoin } from "./meeting-prejoin";
import { MeetingMicDots } from "./meeting-room-mic-check";

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
  requestMock.mockReset();
  useMeetingRoomPreferencesStore.setState({ joinWithMic: null });
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
    expect(await screen.findByRole("button", { name: "Mic", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camera", pressed: true })).toBeInTheDocument();
    expect(await screen.findByText("Built-in Mic")).toBeInTheDocument();
    expect(screen.getByText("FaceTime HD")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mic", pressed: true }));
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
    expect(await screen.findByText("Cho phép mic để chọn thiết bị")).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Cho phép mic" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    await waitFor(() => expect(stop).toHaveBeenCalled());
    expect(await screen.findByText("Built-in Mic")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Mức âm thanh mic" })).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Cho phép mic" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trình duyệt đang chặn mic");
  });

  describe("in a crowded meeting", () => {
    function roster(active: number) {
      requestMock.mockImplementation((path: unknown) =>
        String(path).endsWith("/meetings/m1/participants")
          ? Promise.resolve({
              participants: [
                ...Array.from({ length: active }, (_, i) => ({
                  id: `p${i}`, meeting_id: "m1", principal_type: "USER", role: "PARTICIPANT", status: "ACTIVE",
                })),
                { id: "gone", meeting_id: "m1", principal_type: "USER", role: "PARTICIPANT", status: "REMOVED" },
              ],
            })
          : Promise.resolve({}),
      );
    }

    it("starts with the mic off, says why, and leaves the camera alone", async () => {
      roster(12);
      const onJoin = vi.fn();
      render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={onJoin} onLeave={() => {}} />));
      expect(await screen.findByRole("button", { name: "Mic", pressed: false })).toBeInTheDocument();
      expect(screen.getByText(/Cuộc họp có 12 người nên mic đang tắt sẵn/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Camera", pressed: true })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
      expect(onJoin).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: true }));
    });

    it("keeps the mic on in a small meeting", async () => {
      roster(10);
      render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />));
      await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants"));
      expect(screen.getByRole("button", { name: "Mic", pressed: true })).toBeInTheDocument();
      expect(screen.queryByText(/mic đang tắt sẵn/)).not.toBeInTheDocument();
    });

    it("lets a remembered choice win, and remembers a new one", async () => {
      roster(40);
      useMeetingRoomPreferencesStore.setState({ joinWithMic: true });
      render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />));
      await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants"));
      expect(screen.getByRole("button", { name: "Mic", pressed: true })).toBeInTheDocument();
      expect(screen.queryByText(/mic đang tắt sẵn/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Mic", pressed: true }));
      expect(useMeetingRoomPreferencesStore.getState().joinWithMic).toBe(false);
    });
  });
});

describe("MeetingPreJoin motion (UNI-2285 D)", () => {
  it("mic dots follow the level", () => {
    const { container } = render(<MeetingMicDots level={0.5} />);
    const meter = screen.getByRole("meter", { name: "Mức âm thanh mic" });
    expect(meter).toHaveAttribute("aria-valuenow", "50");
    const dots = container.querySelectorAll("[data-mic-dot]");
    expect(dots).toHaveLength(5);
    // The middle dot stands tallest, the edges shortest.
    const h = [...dots].map((d) => parseFloat((d as HTMLElement).style.height));
    expect(h[2]).toBeGreaterThan(h[1]!);
    expect(h[1]).toBeGreaterThan(h[0]!);
    expect(h[0]).toBe(h[4]);
  });

  it("draws the dots inside the mic picker instead of the old level bar", async () => {
    render(wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={() => {}} onLeave={() => {}} />));
    expect(await screen.findByText("Built-in Mic")).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-mic-level")).not.toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Mức âm thanh mic" })).toHaveAttribute("data-slot", "mic-dots");
  });

  it("member prejoin shows the scribe chip and the full text behind ?", async () => {
    sessionStorage.clear();
    render(
      wrapWithNav(<MeetingPreJoin meeting={meeting} scribeNoticeFor="m1" onJoin={() => {}} onLeave={() => {}} />),
    );
    const chip = screen.getByTestId("meeting-scribe-chip");
    expect(chip).toHaveTextContent("Thư ký UNI ghi lời");
    expect(chip.querySelector("[data-scribe-mark]")).not.toBeNull();
    expect(screen.queryByTestId("meeting-scribe-notice")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đã hiểu" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Thư ký UNI làm gì?" }));
    expect(await screen.findByText(/là trợ lý AI của UniWork/)).toBeInTheDocument();
  });

  it("join button is busy while joining", () => {
    const onJoin = vi.fn();
    render(wrapWithNav(<MeetingPreJoin meeting={meeting} joining onJoin={onJoin} onLeave={() => {}} />));
    const join = screen.getByRole("button", { name: "Vào phòng họp" });
    expect(join).toHaveAttribute("aria-busy", "true");
    expect(join).toHaveAttribute("data-joining");
    fireEvent.click(join);
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("joining freezes the media choice the room opens with", async () => {
    render(wrapWithNav(<MeetingPreJoin meeting={meeting} joining onJoin={() => {}} onLeave={() => {}} />));
    // The room takes the choice made at the press: toggles and pickers go inert, Back stays.
    expect(screen.getByRole("button", { name: "Camera", pressed: true }).closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Mic" }).closest("[inert]")).not.toBeNull();
    expect((await screen.findByText("Built-in Mic")).closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Quay lại" }).closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Vào phòng họp" }).closest("[inert]")).toBeNull();
  });
});
