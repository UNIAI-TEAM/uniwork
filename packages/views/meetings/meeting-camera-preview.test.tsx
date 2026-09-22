import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const applyMeetingBackgroundProcessor = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const createLocalVideoTrack = vi.hoisted(() => vi.fn());
const meetingBackgroundActive = vi.hoisted(() =>
  vi.fn((background: string) => background !== "none"),
);
const supportsBackgroundProcessors = vi.hoisted(() => vi.fn(() => false));

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: "vi" },
    }),
  };
});

vi.mock("./meeting-background-processor", () => ({
  applyMeetingBackgroundProcessor,
  meetingBackgroundActive,
  supportsBackgroundProcessors,
}));

vi.mock("livekit-client", () => ({
  createLocalVideoTrack,
}));

import { MeetingCameraPreview } from "./meeting-camera-preview";

describe("MeetingCameraPreview", () => {
  afterEach(() => {
    vi.clearAllMocks();
    supportsBackgroundProcessors.mockReturnValue(false);
    meetingBackgroundActive.mockImplementation((background: string) => background !== "none");
  });

  it("says the camera is off when inactive, not that the preview is missing", () => {
    render(<MeetingCameraPreview active={false} />);
    expect(screen.getByText("meetings.devicePreviewOff")).toBeInTheDocument();
    expect(screen.queryByText("meetings.devicePreviewEmpty")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.retry" })).not.toBeInTheDocument();
  });

  it("offers a turn-on action while inactive when the caller provides one", () => {
    const onRequestEnable = vi.fn();
    render(<MeetingCameraPreview active={false} onRequestEnable={onRequestEnable} />);
    fireEvent.click(screen.getByRole("button", { name: "meetings.devicePreviewTurnOn" }));
    expect(onRequestEnable).toHaveBeenCalledOnce();
  });

  function mockMedia(getUserMedia: ReturnType<typeof vi.fn>) {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([{ kind: "videoinput", deviceId: "cam-1" }]),
        getUserMedia,
      },
    });
  }

  it("tells the user another app holds the camera and retries on demand", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("busy", "NotReadableError"))
      .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    mockMedia(getUserMedia);

    render(<MeetingCameraPreview active />);

    expect(await screen.findByText("meetings.devicePreviewInUse")).toBeInTheDocument();
    expect(screen.queryByText("meetings.devicePreviewError")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("meetings.devicePreviewInUse")).not.toBeInTheDocument(),
    );
  });

  it("maps the legacy TrackStartError to the in-use state", async () => {
    mockMedia(vi.fn().mockRejectedValue(new DOMException("busy", "TrackStartError")));
    render(<MeetingCameraPreview active />);
    expect(await screen.findByText("meetings.devicePreviewInUse")).toBeInTheDocument();
  });

  it("explains how to allow the camera when permission is denied, with a retry", async () => {
    mockMedia(vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")));
    render(<MeetingCameraPreview active />);
    expect(await screen.findByText("meetings.devicePreviewPermissionDismissed")).toBeInTheDocument();
    expect(screen.getByText("meetings.devicePreviewDeniedHint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.retry" })).toBeInTheDocument();
  });

  it("offers a retry when no camera is found", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: vi.fn().mockResolvedValue([]), getUserMedia: vi.fn() },
    });
    render(<MeetingCameraPreview active />);
    expect(await screen.findByText("meetings.devicePreviewNoCamera")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.retry" })).toBeInTheDocument();
  });

  it("uses the raw media stream path when background effects are unavailable", async () => {
    const stop = vi.fn();
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([{ kind: "videoinput", deviceId: "cam-1" }]),
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop }],
        }),
      },
    });

    render(<MeetingCameraPreview active deviceId="cam-1" mirrorCamera />);

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        video: { deviceId: { exact: "cam-1" } },
        audio: false,
      });
    });
    expect(screen.getByLabelText("meetings.devicePreviewTitle")).toHaveClass("scale-x-[-1]");
  });

  it("applies background processors when supported", async () => {
    supportsBackgroundProcessors.mockReturnValue(true);
    meetingBackgroundActive.mockReturnValue(true);
    const stop = vi.fn();
    const attach = vi.fn();
    const play = vi.fn().mockResolvedValue(undefined);
    createLocalVideoTrack.mockResolvedValue({
      attach,
      detach: vi.fn(),
      stop,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });

    render(
      <MeetingCameraPreview
        active
        background="custom"
        customBackgroundDataUrl="data:image/png;base64,abc"
      />,
    );

    await waitFor(() => {
      expect(createLocalVideoTrack).toHaveBeenCalledOnce();
      expect(applyMeetingBackgroundProcessor).toHaveBeenCalledOnce();
    });
  });
});
