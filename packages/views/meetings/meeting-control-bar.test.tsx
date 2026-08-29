import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { MeetingControlBar } from "./meeting-control-bar";

let mobile = false;
vi.mock("@uniwork/ui/hooks/use-mobile", () => ({ useIsMobile: () => mobile, useIsCompact: () => mobile }));
vi.mock("@livekit/components-react", () => ({
  useTrackToggle: () => ({ enabled: true, pending: false, toggle: vi.fn() }),
}));
vi.mock("./use-meeting-signals", () => ({
  useMeetingSignals: () => ({ handRaised: false, toggleHand: vi.fn(), react: vi.fn(), hands: [], reactions: [] }),
}));

beforeAll(() => {
  initI18n();
});

const bar = () => (
  <MeetingControlBar onLeave={() => {}} meetingId="m1" canHost recordingEnabled captionsAvailable onToggleCaptions={() => {}} />
);

describe("MeetingControlBar", () => {
  it("names toggles by what they are and carries state in aria-pressed", () => {
    mobile = false;
    render(wrapWithNav(bar()));
    expect(screen.getByRole("button", { name: "Mic", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghi hình", pressed: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thêm" })).not.toBeInTheDocument();
  });

  it("folds reactions, captions and recording behind More on phones", () => {
    mobile = true;
    render(wrapWithNav(bar()));
    expect(screen.getByRole("button", { name: "Thêm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ghi hình" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mic", pressed: true })).toBeInTheDocument();
  });
});
