import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { MeetingStageFooter } from "./meeting-stage-footer";

vi.mock("@livekit/components-react", () => ({ useParticipants: () => [] }));
vi.mock("./use-meeting-signals", () => ({
  useMeetingSignals: () => ({ hands: [], handRaised: false }),
}));

/** A prompt with nothing to ask: what MeetingVotePrompt renders most of the time. */
function Nothing() {
  return null;
}

afterEach(() => {
  useMeetingRoomPreferencesStore.setState({ controlBarAutoHide: false });
});

describe("MeetingStageFooter", () => {
  it("stacks the prompt first in the measured stack, clickable through the click-through footer", () => {
    render(
      <MeetingStageFooter
        stageContentRef={createRef<HTMLDivElement>()}
        captionsOn={false}
        prompt={<p>Mời bỏ phiếu</p>}
        controlBar={<button type="button">Rời phòng</button>}
      />,
    );
    const slot = screen.getByText("Mời bỏ phiếu").parentElement!;
    const dock = screen.getByTestId("meeting-control-dock");
    expect(slot).toHaveClass("pointer-events-auto");
    // Same parent as the dock: the reserve measurement counts the card.
    expect(dock.parentElement?.firstElementChild).toBe(slot);
  });

  it("adds nothing above the dock without a prompt", () => {
    render(
      <MeetingStageFooter
        stageContentRef={createRef<HTMLDivElement>()}
        captionsOn={false}
        prompt={null}
        controlBar={<button type="button">Rời phòng</button>}
      />,
    );
    const dock = screen.getByTestId("meeting-control-dock");
    expect(dock.parentElement?.firstElementChild).toBe(dock);
  });

  it("reserves no gap for a prompt that renders nothing", () => {
    // Auto-hide starts with the dock hidden, so the collapsed reserve is applied.
    useMeetingRoomPreferencesStore.setState({ controlBarAutoHide: true });
    const onReserve = vi.fn();
    render(
      <MeetingStageFooter
        stageContentRef={createRef<HTMLDivElement>()}
        captionsOn={false}
        prompt={<Nothing />}
        controlBar={<button type="button">Rời phòng</button>}
        onReserveHeightChange={onReserve}
      />,
    );
    // Nothing above a hidden dock: the bare minimum (COLLAPSED_RESERVE_MIN_PX), not 8 + a gap.
    expect(onReserve).toHaveBeenLastCalledWith(8);
  });
});
