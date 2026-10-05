import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { MeetingDevicesDialog } from "./meeting-devices-dialog";

const devices = vi.hoisted(() => ({
  list: [] as Array<{ deviceId: string; label: string }>,
  micOn: false,
}));

vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => ({ switchActiveDevice: vi.fn() }),
  useLocalParticipant: () => ({
    isCameraEnabled: false,
    isMicrophoneEnabled: devices.micOn,
    microphoneTrack: devices.micOn ? { audioTrack: { mediaStreamTrack: { kind: "audio" } } } : undefined,
  }),
  useMediaDeviceSelect: () => ({ devices: devices.list, activeDeviceId: "", setActiveMediaDevice: vi.fn() }),
}));
vi.mock("./meeting-camera-preview", () => ({ MeetingCameraPreview: () => <div data-testid="preview" /> }));
vi.mock("./meeting-room-mic-check", async (importActual) => ({
  ...(await importActual<typeof import("./meeting-room-mic-check")>()),
  MeetingMicLevel: ({ track }: { track?: unknown }) => (
    <div data-testid="mic-level" data-borrowed={track ? "yes" : "no"} />
  ),
}));
vi.mock("./meeting-background-image", () => ({
  backgroundImageDataUrl: () => Promise.resolve("data:image/jpeg;base64,AA=="),
}));
vi.mock("./meeting-background-processor", () => ({
  meetingBackgroundActive: (b: string) => b !== "none",
  supportsBackgroundProcessors: () => Promise.resolve(true),
}));

beforeAll(() => {
  initI18n();
});

const initialPreferences = useMeetingRoomPreferencesStore.getState();

beforeEach(() => {
  devices.list = [];
  devices.micOn = false;
  useMeetingRoomPreferencesStore.setState({ ...initialPreferences, background: "none", customBackgroundDataUrl: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MeetingDevicesDialog", () => {
  function open() {
    render(<MeetingDevicesDialog open onOpenChange={() => {}} trigger={null} />);
  }

  it("names its close button in the viewer's language", () => {
    open();
    expect(screen.getByRole("button", { name: "Đóng" })).toBeInTheDocument();
  });

  it("puts the devices before the switches, so a phone and the first Tab reach them first", () => {
    open();
    const reload = screen.getByRole("button", { name: /Tải lại/ });
    const mirror = screen.getByRole("switch", { name: /Lật ngang hình của bạn/ });
    expect(reload.compareDocumentPosition(mirror) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers a way to grant access when the browser has listed no camera or mic", () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: vi.fn() } });
    open();
    expect(screen.getAllByRole("button", { name: "Cho phép truy cập" })).toHaveLength(2);
  });

  it("shows the mic level only while the mic is on in the meeting", () => {
    devices.list = [{ deviceId: "a", label: "Built-in" }];
    open();
    expect(screen.queryByTestId("mic-level")).not.toBeInTheDocument();
    expect(screen.getByText(/Mic của bạn đang tắt/)).toBeInTheDocument();
  });

  it("keeps the meter once the mic is on, and offers a speaker test", () => {
    devices.list = [{ deviceId: "a", label: "Built-in" }];
    devices.micOn = true;
    open();
    // It reads the track the room already hears, not a second capture.
    expect(screen.getByTestId("mic-level")).toHaveAttribute("data-borrowed", "yes");
    expect(screen.getByRole("button", { name: "Phát âm thanh thử" })).toBeInTheDocument();
  });

  it("marks the chosen background and switches on click", () => {
    open();
    expect(screen.getByRole("button", { name: "Không" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Thiên nhiên" }));
    expect(useMeetingRoomPreferencesStore.getState().background).toBe("nature");
    expect(screen.getByRole("button", { name: "Thiên nhiên" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lists an uploaded image as its own background, apart from the upload action", () => {
    useMeetingRoomPreferencesStore.setState({ customBackgroundDataUrl: "data:image/png;base64,AA==" });
    open();
    expect(screen.getByRole("button", { name: "Ảnh của bạn" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Tải ảnh lên" })).not.toHaveAttribute("aria-pressed");
  });

  it("keeps focus on Reload while the device lists are fetched again", () => {
    open();
    const reload = screen.getByRole("button", { name: /Tải lại/ });
    reload.focus();
    fireEvent.click(reload);
    expect(reload).toBeInTheDocument();
    expect(document.activeElement).toBe(reload);
  });

  it("moves focus to the camera picker once access is granted", async () => {
    const getUserMedia = vi.fn(() => {
      devices.list = [{ deviceId: "cam-1", label: "FaceTime HD" }];
      return Promise.resolve({ getTracks: () => [] });
    });
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });
    open();
    const [cameraAllow] = screen.getAllByRole("button", { name: "Cho phép truy cập" });
    await act(async () => {
      fireEvent.click(cameraAllow!);
    });
    expect(getUserMedia).toHaveBeenCalledWith({ video: true });
    await waitFor(() => expect(document.activeElement?.id).toBe("room-device-camera"));
  });

  it("says so when the browser cannot keep an uploaded image", async () => {
    useMeetingRoomPreferencesStore.setState({
      setCustomBackgroundDataUrl: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    open();
    const input = screen.getByLabelText("Tải ảnh lên", { selector: "input" });
    const file = new File(["x"], "me.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(await screen.findByText(/không lưu được ảnh này/)).toBeInTheDocument();
    expect(useMeetingRoomPreferencesStore.getState().background).toBe("none");
  });
});
