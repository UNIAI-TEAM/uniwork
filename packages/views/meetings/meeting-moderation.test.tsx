import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Participant } from "livekit-client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { MeetingModerationMenuItems, MeetingModerationProvider, MeetingMuteAllButton } from "./meeting-moderation";

const api = vi.hoisted(() => ({
  publish: vi.fn(),
  remove: vi.fn(),
  requestMute: vi.fn(),
  requestMuteAll: vi.fn(),
}));

vi.mock("@uniwork/core/meetings", () => ({
  useSetParticipantPublish: () => ({ mutate: api.publish, isPending: false }),
  useRemoveParticipant: () => ({ mutate: api.remove, isPending: false }),
}));
vi.mock("./use-meeting-signals", () => ({
  useRequestMute: () => api.requestMute,
  useMeetingSignals: () => ({ requestMuteAll: api.requestMuteAll }),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  api.publish.mockClear();
  api.remove.mockClear();
  api.requestMute.mockClear();
  api.requestMuteAll.mockClear();
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
    // Named like its siblings, so the item says who it acts on out of context.
    fireEvent.click(screen.getByRole("menuitem", { name: "Mời Lan ra khỏi cuộc họp" }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Mời Lan ra khỏi cuộc họp?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mời ra khỏi cuộc họp" }));
    expect(api.remove).toHaveBeenCalledWith("p1", expect.anything());
  });

  it("offers no host action it could not carry out", () => {
    // Every UniWork seat joins as uw_participant_<id>; anything else in the
    // room has no participant row to act on, so its confirm could never work.
    renderMenu({ ...person(), identity: "EG_recorder" } as unknown as Participant);
    expect(screen.queryByRole("menuitem", { name: /ra khỏi cuộc họp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /mic/ })).not.toBeInTheDocument();
  });

  it("shows nothing to someone who cannot host", () => {
    renderMenu(person(), { canHost: false });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});

describe("MeetingMuteAllButton", () => {
  it("asks the host first, then mutes the room", () => {
    render(
      <MeetingModerationProvider meetingId="m1" canHost>
        <MeetingMuteAllButton />
      </MeetingModerationProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tắt mic mọi người" }));
    expect(api.requestMuteAll).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "Tắt mic mọi người?" });
    expect(dialog).toHaveTextContent("trừ chủ trì");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tắt mic mọi người" }));
    expect(api.requestMuteAll).toHaveBeenCalledTimes(1);
  });

  it("is not there for someone who cannot host", () => {
    render(
      <MeetingModerationProvider meetingId="m1" canHost={false}>
        <MeetingMuteAllButton />
      </MeetingModerationProvider>,
    );
    expect(screen.queryByRole("button", { name: "Tắt mic mọi người" })).not.toBeInTheDocument();
  });
});
