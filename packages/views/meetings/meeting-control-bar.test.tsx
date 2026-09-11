import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { MeetingControlBar } from "./meeting-control-bar";

let mobile = false;
let handRaised = false;
const startRecording = vi.fn();
const stopRecording = vi.fn();

vi.mock("@uniwork/ui/hooks/use-mobile", () => ({ useIsMobile: () => mobile, useIsCompact: () => mobile }));
vi.mock("@livekit/components-react", () => ({
  useTrackToggle: () => ({ enabled: true, pending: false, toggle: vi.fn() }),
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
    expect(screen.getByRole("button", { name: "Ghi hình", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thêm" })).toBeInTheDocument();
  });

  it("folds reactions, captions and recording behind More on phones", () => {
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
    expect(screen.getByRole("button", { name: "Mic", pressed: true })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Ghi hình", pressed: true })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Ghi hình", pressed: false }));
    expect(startRecording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu ghi hình" }));
    expect(startRecording).toHaveBeenCalledOnce();
  });

  it("stops an active recording and hides captions when unavailable", () => {
    mobile = false;
    handRaised = false;
    stopRecording.mockClear();
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
    fireEvent.click(screen.getByRole("button", { name: "Ghi hình", pressed: true }));
    expect(stopRecording).toHaveBeenCalledOnce();

    rerender(
      wrapWithNav(
        <MeetingControlBar onLeave={() => {}} meetingId="m1" canHost recordingEnabled />,
      ),
    );
    expect(screen.queryByRole("button", { name: "Phụ đề" })).not.toBeInTheDocument();
  });

  it("renders a floating footer and exposes captions inside More on phones", () => {
    mobile = true;
    handRaised = false;
    render(
      wrapWithNav(
        <MeetingControlBar
          floating
          onLeave={() => {}}
          meetingId="m1"
          canHost
          recordingEnabled
          captionsAvailable
          onToggleCaptions={() => {}}
        />,
      ),
    );
    expect(document.querySelector("footer.pointer-events-none")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(screen.getByRole("button", { name: "Phụ đề" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghi hình" })).toBeInTheDocument();
  });

  it("opens AI copilot panel when the sparkles control is pressed", () => {
    mobile = false;
    handRaised = false;
    const onOpenCopilot = vi.fn();
    render(
      wrapWithNav(
        <MeetingControlBar onLeave={() => {}} onOpenCopilot={onOpenCopilot} copilotActive={false} />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mở panel AI" }));
    expect(onOpenCopilot).toHaveBeenCalledOnce();
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
