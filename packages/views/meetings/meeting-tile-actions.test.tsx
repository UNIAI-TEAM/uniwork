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

function renderShare({
  canHost = false,
  visible = true,
  fullscreen,
}: {
  canHost?: boolean;
  visible?: boolean;
  fullscreen?: { active: boolean; onToggle: () => void };
}) {
  return render(
    <MeetingTileActions
      participant={lan}
      name="Lan"
      pinned={false}
      compact={false}
      canHost={canHost}
      micMuted={false}
      screenShare
      visible={visible}
      fullscreen={fullscreen}
      onMenuOpenChange={() => {}}
      onPin={() => {}}
    />,
  );
}

describe("MeetingTileActions on a share", () => {
  it("lets any viewer enlarge it", () => {
    const onToggle = vi.fn();
    renderShare({ fullscreen: { active: false, onToggle } });
    fireEvent.click(screen.getByRole("button", { name: "Toàn màn hình" }));
    expect(onToggle).toHaveBeenCalledOnce();
    // A viewer who is not the host has nothing else to do with a share.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps only the way out while in full screen, where a menu could not open", () => {
    renderShare({ canHost: true, fullscreen: { active: true, onToggle: () => {} } });
    expect(screen.getByRole("button", { name: "Thoát toàn màn hình" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thao tác/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tắt mic của Lan")).not.toBeInTheDocument();
  });

  it("lets focus alone pin the chip up out of full screen, never in it", () => {
    const { rerender } = renderShare({ visible: false, fullscreen: { active: false, onToggle: () => {} } });
    const chip = () => screen.getByRole("button").parentElement!;
    expect(chip()).toHaveClass("group-focus-within:opacity-100");
    rerender(
      <MeetingTileActions
        participant={lan}
        name="Lan"
        pinned={false}
        compact={false}
        canHost={false}
        micMuted={false}
        screenShare
        visible={false}
        fullscreen={{ active: true, onToggle: () => {} }}
        onMenuOpenChange={() => {}}
        onPin={() => {}}
      />,
    );
    // The toggle keeps focus after entering, and the idle hide owns the chip there.
    expect(chip()).toHaveClass("opacity-0");
    expect(chip()).not.toHaveClass("group-focus-within:opacity-100");
  });

  it("gives the host full screen beside their actions", () => {
    renderShare({ canHost: true, fullscreen: { active: false, onToggle: () => {} } });
    expect(screen.getByRole("button", { name: "Toàn màn hình" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tắt mic của Lan")).toBeInTheDocument();
  });

  it("shows nothing to a viewer where full screen is not available", () => {
    const { container } = renderShare({});
    expect(container).toBeEmptyDOMElement();
  });
});

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
