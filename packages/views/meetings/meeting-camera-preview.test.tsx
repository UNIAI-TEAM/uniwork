import { render, screen, waitFor } from "@testing-library/react";
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

  it("shows empty preview copy when inactive", () => {
    render(<MeetingCameraPreview active={false} />);
    expect(screen.getByText("meetings.devicePreviewEmpty")).toBeInTheDocument();
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
