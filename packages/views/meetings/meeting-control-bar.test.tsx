import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import { wrapWithNav } from "../test/api-mock";
import { MeetingControlBar } from "./meeting-control-bar";

let mobile = false;
let handRaised = false;
const startRecording = vi.fn();
const stopRecording = vi.fn();
const toggles = vi.hoisted(() => ({ microphone: vi.fn(), camera: vi.fn(), screen_share: vi.fn() }));
const shareErrors = vi.hoisted(() => ({ onDeviceError: null as null | ((error: Error) => void) }));
// The viewer's own publish permissions; `[1, 3, 4]` is the host's mic lock.
const local = vi.hoisted(() => ({
  participant: { permissions: { canPublish: true, canPublishSources: [] as number[] }, on: () => {}, off: () => {} },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@uniwork/ui/hooks/use-mobile", () => ({ useIsMobile: () => mobile, useIsCompact: () => mobile }));
vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => ({}),
  useLocalParticipant: () => ({ localParticipant: local.participant }),
  useTrackToggle: ({ source, onDeviceError }: { source: keyof typeof toggles; onDeviceError?: (e: Error) => void }) => {
    if (source === "screen_share") shareErrors.onDeviceError = onDeviceError ?? null;
    return { enabled: true, pending: false, toggle: toggles[source] };
  },
}));
vi.mock("@uniwork/core/meetings", () => ({
  useStartRecording: () => ({ mutate: startRecording, isPending: false }),
  useStopRecording: () => ({ mutate: stopRecording, isPending: false }),
}));
vi.mock("./use-meeting-signals", () => ({
  useMeetingSignals: () => ({
    handRaised,
    toggleHand: vi.fn(),
    react: vi.fn(),
    hands: [],
    reactions: [],
  }),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia: vi.fn() },
  });
});

function namedError(name: string, message = ""): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("MeetingControlBar", () => {
  it("names toggles by what they are and carries state in aria-pressed", () => {
    mobile = false;
    handRaised = false;
    render(
      wrapWithNav(
        <MeetingControlBar
          onLeave={() => {}}
          meetingId="m1"
          canHost
          recordingEnabled
          captionsAvailable
          onToggleCaptions={() => {}}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: "Mic", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghi hình" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thêm" })).toBeInTheDocument();
  });

  it("folds screen share, hand, captions and recording behind More on phones", () => {
    mobile = true;
    handRaised = false;
    render(
      wrapWithNav(
        <MeetingControlBar
          onLeave={() => {}}
          meetingId="m1"
          canHost
          recordingEnabled
          captionsAvailable
          onToggleCaptions={() => {}}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: "Thêm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ghi hình" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /chia sẻ/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Giơ tay" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mic", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camera", pressed: true })).toBeInTheDocument();
  });

  it("shows active hand, captions and recording states on desktop", () => {
    mobile = false;
    handRaised = true;
    render(
      wrapWithNav(
        <MeetingControlBar
          onLeave={() => {}}
          meetingId="m1"
          canHost
          recordingEnabled
          recording
          captionsAvailable
          captionsOn
          onToggleCaptions={() => {}}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: "Giơ tay", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phụ đề", pressed: true })).toBeInTheDocument();
    // While recording the control names what pressing it does next.
    expect(screen.getByRole("button", { name: "Dừng ghi hình" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ghi hình" })).not.toBeInTheDocument();
  });

  it("hides host-only recording for guests", () => {
    mobile = false;
    handRaised = false;
    render(
      wrapWithNav(
        <MeetingControlBar
          onLeave={() => {}}
          meetingId="m1"
          captionsAvailable
          onToggleCaptions={() => {}}
        />,
      ),
    );
    expect(screen.queryByRole("button", { name: "Ghi hình" })).not.toBeInTheDocument();
  });

  it("starts recording after the host confirms scope", () => {
    mobile = false;
    handRaised = false;
    startRecording.mockClear();
    render(
      wrapWithNav(
        <MeetingControlBar
          onLeave={() => {}}
          meetingId="m1"
          canHost
          recordingEnabled
          captionsAvailable
          onToggleCaptions={() => {}}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ghi hình" }));
    expect(startRecording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu ghi hình" }));
    expect(startRecording).toHaveBeenCalledOnce();
  });

  it("stops an active recording, confirms it, and hides captions when unavailable", () => {
    mobile = false;
    handRaised = false;
    stopRecording.mockReset();
    stopRecording.mockImplementation((_: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
    vi.mocked(toast.success).mockClear();
    const { rerender } = render(
      wrapWithNav(
        <MeetingControlBar
          onLeave={() => {}}
          meetingId="m1"
          canHost
          recordingEnabled
          recording
          captionsAvailable
          captionsOn
          onToggleCaptions={() => {}}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dừng ghi hình" }));
    expect(stopRecording).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith("Đã dừng ghi hình", expect.anything());

    rerender(
      wrapWithNav(
        <MeetingControlBar onLeave={() => {}} meetingId="m1" canHost recordingEnabled />,
      ),
    );
    expect(screen.queryByRole("button", { name: "Phụ đề" })).not.toBeInTheDocument();
  });

  it("exposes share, hand, captions and recording inside More on phones", () => {
    mobile = true;
    handRaised = false;
    render(
      wrapWithNav(
        <MeetingControlBar
          onLeave={() => {}}
          meetingId="m1"
          canHost
          recordingEnabled
          captionsAvailable
          onToggleCaptions={() => {}}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(screen.getByRole("button", { name: "Dừng chia sẻ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giơ tay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phụ đề" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghi hình" })).toBeInTheDocument();
  });

  it("toggles the AI copilot panel: one name, state in aria-pressed", () => {
    mobile = false;
    handRaised = false;
    const onToggleCopilot = vi.fn();
    const { rerender } = render(
      wrapWithNav(
        <MeetingControlBar onLeave={() => {}} onToggleCopilot={onToggleCopilot} copilotActive={false} />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "AI Copilot", pressed: false }));
    expect(onToggleCopilot).toHaveBeenCalledOnce();
    rerender(
      wrapWithNav(<MeetingControlBar onLeave={() => {}} onToggleCopilot={onToggleCopilot} copilotActive />),
    );
    fireEvent.click(screen.getByRole("button", { name: "AI Copilot", pressed: true }));
    expect(onToggleCopilot).toHaveBeenCalledTimes(2);
  });

  it("toggles mic with Ctrl+D and camera with Ctrl+E, but not while typing", () => {
    mobile = false;
    handRaised = false;
    toggles.microphone.mockClear();
    toggles.camera.mockClear();
    render(
      wrapWithNav(
        <>
          <MeetingControlBar onLeave={() => {}} />
          <input aria-label="draft" />
        </>,
      ),
    );
    const mic = fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(mic).toBe(false);
    expect(toggles.microphone).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "e", metaKey: true });
    expect(toggles.camera).toHaveBeenCalledOnce();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "draft" }), { key: "d", ctrlKey: true });
    expect(toggles.microphone).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "d" });
    expect(toggles.microphone).toHaveBeenCalledOnce();
  });

  it("asks before leaving the room", () => {
    mobile = false;
    handRaised = false;
    const onLeave = vi.fn();
    render(wrapWithNav(<MeetingControlBar onLeave={onLeave} />));
    fireEvent.click(screen.getByRole("button", { name: "Rời phòng" }));
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Rời ngay" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});

describe("MeetingControlBar with a locked mic", () => {
  it("says the host locked the mic instead of toggling it", () => {
    local.participant.permissions.canPublishSources = [1, 3, 4];
    try {
      toggles.microphone.mockClear();
      render(wrapWithNav(<MeetingControlBar onLeave={() => {}} />));
      fireEvent.click(screen.getByRole("button", { name: "Mic" }));
      expect(toggles.microphone).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith("Chủ trì đã khóa mic của bạn", expect.anything());
    } finally {
      local.participant.permissions.canPublishSources = [];
    }
  });
});

describe("MeetingControlBar reactions", () => {
  it("names each reaction in words, not by the emoji", () => {
    mobile = false;
    handRaised = false;
    render(wrapWithNav(<MeetingControlBar onLeave={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    fireEvent.click(screen.getByRole("button", { name: "Biểu cảm" }));
    expect(screen.getByRole("button", { name: "Thích" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vỗ tay" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "👍" })).not.toBeInTheDocument();
  });

  it("names the share control by its next action and hides it where capture is impossible", () => {
    mobile = false;
    const { unmount } = render(wrapWithNav(<MeetingControlBar onLeave={() => {}} />));
    expect(screen.getByRole("button", { name: "Dừng chia sẻ", pressed: true })).toBeInTheDocument();
    unmount();

    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    render(wrapWithNav(<MeetingControlBar onLeave={() => {}} />));
    expect(screen.queryByRole("button", { name: /chia sẻ/i })).not.toBeInTheDocument();
  });

  it("says why a share could not start, and stays quiet when the picker is closed", () => {
    mobile = false;
    vi.mocked(toast.error).mockClear();
    render(wrapWithNav(<MeetingControlBar onLeave={() => {}} />));
    shareErrors.onDeviceError?.(namedError("NotAllowedError", "Permission denied"));
    expect(toast.error).not.toHaveBeenCalled();
    shareErrors.onDeviceError?.(namedError("NotAllowedError", "Permission denied by system"));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Cài đặt hệ thống/));
    shareErrors.onDeviceError?.(namedError("NotReadableError"));
    expect(toast.error).toHaveBeenLastCalledWith("Không bắt đầu chia sẻ màn hình được. Thử lại hoặc chọn cửa sổ khác.");
  });
});
