import { fireEvent, render, screen } from "@testing-library/react";
import type { Participant } from "livekit-client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { MeetingModerationMenuItems, MeetingModerationProvider } from "./meeting-moderation";

const api = vi.hoisted(() => ({
  publish: vi.fn(),
  remove: vi.fn(),
  requestMute: vi.fn(),
}));

vi.mock("@uniwork/core/meetings", () => ({
  useSetParticipantPublish: () => ({ mutate: api.publish, isPending: false }),
  useRemoveParticipant: () => ({ mutate: api.remove, isPending: false }),
}));
vi.mock("./use-meeting-signals", () => ({ useRequestMute: () => api.requestMute }));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  api.publish.mockClear();
  api.remove.mockClear();
  api.requestMute.mockClear();
});

function person(micLocked = false): Participant {
  return {
    identity: "uw_participant_p1",
    name: "Lan",
    isLocal: false,
    // The host's lock lists every source but the mic (2): camera, share, share audio.
    permissions: { canPublish: true, canPublishSources: micLocked ? [1, 3, 4] : [] },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Participant;
}

function renderMenu(participant: Participant, { canHost = true, micMuted = false } = {}) {
  render(
    <MeetingModerationProvider meetingId="m1" canHost={canHost}>
      <DropdownMenu>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <MeetingModerationMenuItems participant={participant} micMuted={micMuted} />
        </DropdownMenuContent>
      </DropdownMenu>
    </MeetingModerationProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
}

describe("MeetingModerationMenuItems", () => {
  it("offers mute, lock and remove to the host of a live mic", () => {
    renderMenu(person());
    fireEvent.click(screen.getByRole("menuitem", { name: "Tắt mic của Lan" }));
    expect(api.requestMute).toHaveBeenCalledWith("uw_participant_p1", "Lan");
  });

  it("locks the mic even when the person already muted themselves", () => {
    renderMenu(person(), { micMuted: true });
    expect(screen.queryByRole("menuitem", { name: "Tắt mic của Lan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Khóa mic của Lan" }));
    expect(api.publish).toHaveBeenCalledWith({ participantId: "p1", enabled: false }, expect.anything());
  });

  it("offers unlock, not 'allow again', only for a mic the host locked", () => {
    renderMenu(person(true), { micMuted: true });
    expect(screen.queryByRole("menuitem", { name: "Khóa mic của Lan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Mở khóa mic của Lan" }));
    expect(api.publish).toHaveBeenCalledWith({ participantId: "p1", enabled: true }, expect.anything());
  });

  it("asks before removing someone", () => {
    renderMenu(person());
    fireEvent.click(screen.getByRole("menuitem", { name: "Mời ra khỏi cuộc họp" }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Mời Lan ra khỏi cuộc họp?" })).toBeInTheDocument();
  });

  it("shows nothing to someone who cannot host", () => {
    renderMenu(person(), { canHost: false });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
