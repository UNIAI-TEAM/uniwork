import { fireEvent, render, screen } from "@testing-library/react";
import type { Participant } from "livekit-client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingTileActions } from "./meeting-tile-actions";

vi.mock("./use-meeting-signals", () => ({ useRequestMute: () => vi.fn() }));
vi.mock("./meeting-moderation", () => ({ MeetingModerationMenuItems: () => null }));
vi.mock("@uniwork/core/meetings/view-session", () => ({
  useMeetingViewSessionStore: (sel: (s: { toggleHidden: () => void; isHidden: () => boolean }) => unknown) =>
    sel({ toggleHidden: vi.fn(), isHidden: () => false }),
}));

beforeAll(() => {
  initI18n();
});

const lan = { identity: "uw_participant_p1", name: "Lan", isLocal: false } as unknown as Participant;

function renderActions(micMuted: boolean) {
  render(
    <MeetingTileActions
      participant={lan}
      name="Lan"
      pinned={false}
      compact={false}
      canHost
      micMuted={micMuted}
      screenShare={false}
      visible
      onMenuOpenChange={() => {}}
      onPin={() => {}}
    />,
  );
}

describe("MeetingTileActions", () => {
  it("keeps the mute slot once the mic is off, so pin does not slide under the pointer", () => {
    renderActions(true);
    const mute = screen.getByLabelText("Tắt mic của Lan");
    expect(mute).toHaveClass("invisible");
    expect(mute).toBeDisabled();
  });

  it("offers mute while the mic is live", () => {
    renderActions(false);
    const mute = screen.getByLabelText("Tắt mic của Lan");
    expect(mute).not.toHaveClass("invisible");
    expect(mute).toBeEnabled();
  });

  it("hands focus to the menu when the quick mute is used", () => {
    renderActions(false);
    fireEvent.click(screen.getByLabelText("Tắt mic của Lan"));
    expect(screen.getByRole("button", { name: /Thao tác với Lan/ })).toHaveFocus();
  });
});
