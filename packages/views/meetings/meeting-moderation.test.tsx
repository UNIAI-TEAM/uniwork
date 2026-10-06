import { fireEvent, render, screen, within } from "@testing-library/react";
import { Track, type Participant } from "livekit-client";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { MeetingModerationMenuItems, MeetingModerationProvider, MeetingMuteAllButton } from "./meeting-moderation";

const api = vi.hoisted(() => ({
  hostUserId: "u-host" as string | undefined,
  participantsLoaded: true,
  publish: vi.fn(),
  remove: vi.fn(),
  requestMute: vi.fn(),
  requestMuteAll: vi.fn(),
}));

vi.mock("@uniwork/core/meetings", () => ({
  useMeeting: () => ({ data: { id: "m1", host_user_id: api.hostUserId } }),
  useParticipants: () => ({
    data: !api.participantsLoaded ? undefined : [
      { id: "p-host", user_id: "u-host", role: "MODERATOR" },
      { id: "p1", user_id: "u-lan", role: "PARTICIPANT" },
      // A HOST role who is not the meeting's host: the server locks their share.
      { id: "p-cohost", user_id: "u-co", role: "HOST" },
    ],
  }),
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
  api.hostUserId = "u-host";
  api.participantsLoaded = true;
  api.publish.mockClear();
  api.remove.mockClear();
  api.requestMute.mockClear();
  api.requestMuteAll.mockClear();
});

function person(
  micLocked = false,
  { shareLocked = false, sharing = false, identity = "uw_participant_p1" } = {},
): Participant {
  // A lock lists every source but the locked ones: camera 1, mic 2, share 3,
  // share audio 4 (a locked mic takes the share's audio with it).
  const sources = micLocked || shareLocked ? [1, 2, 3, 4].filter(
    (s) => !(micLocked && (s === 2 || s === 4)) && !(shareLocked && (s === 3 || s === 4)),
  ) : [];
  return {
    identity,
    name: "Lan",
    isLocal: false,
    permissions: { canPublish: true, canPublishSources: sources },
    getTrackPublication: (source: Track.Source) =>
      sharing && source === Track.Source.ScreenShare ? { source, trackSid: "TR_share" } : undefined,
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
    expect(api.publish).toHaveBeenCalledWith(
      { participantId: "p1", enabled: false, source: "microphone" },
      expect.anything(),
    );
  });

  it("offers unlock, not 'allow again', only for a mic the host locked", () => {
    renderMenu(person(true), { micMuted: true });
    expect(screen.queryByRole("menuitem", { name: "Khóa mic của Lan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Mở khóa mic của Lan" }));
    expect(api.publish).toHaveBeenCalledWith(
      { participantId: "p1", enabled: true, source: "microphone" },
      expect.anything(),
    );
  });

  it("locks the screen sharing of someone who is not presenting, without promising a stop", () => {
    renderMenu(person());
    expect(screen.queryByRole("menuitem", { name: /Dừng và khóa chia sẻ/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Khóa chia sẻ màn hình của Lan" }));
    expect(api.publish).toHaveBeenCalledWith(
      { participantId: "p1", enabled: false, source: "screen_share" },
      expect.anything(),
    );
  });

  it("stops and locks the share of someone presenting now", () => {
    renderMenu(person(false, { sharing: true }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dừng và khóa chia sẻ màn hình của Lan" }));
    expect(api.publish).toHaveBeenCalledWith(
      { participantId: "p1", enabled: false, source: "screen_share" },
      expect.anything(),
    );
  });

  it("words a failed lock in the reader's language, not the server's", async () => {
    const toastError = vi.spyOn(toast, "error");
    api.publish.mockImplementationOnce((_vars, opts: { onError: (err: unknown) => void }) =>
      opts.onError(new ApiError("không đọc được quyền media hiện tại", "provider_unavailable", 503)),
    );
    await setLocale("en");
    try {
      renderMenu(person(false, { sharing: true }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Stop and lock Lan's screen sharing" }));
      expect(toastError).toHaveBeenCalledWith("The meeting service didn't respond. Try again.");
      expect(toastError).not.toHaveBeenCalledWith("không đọc được quyền media hiện tại");
    } finally {
      await setLocale("vi");
      toastError.mockRestore();
    }
  });

  it("offers 'share again' only for a share the host locked, apart from the mic", () => {
    renderMenu(person(false, { shareLocked: true }));
    // The mic is still open: its own items stay.
    expect(screen.getByRole("menuitem", { name: "Khóa mic của Lan" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /khóa chia sẻ/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cho Lan chia sẻ màn hình lại" }));
    expect(api.publish).toHaveBeenCalledWith(
      { participantId: "p1", enabled: true, source: "screen_share" },
      expect.anything(),
    );
  });

  it("reads a locked mic as a mic lock, not a share lock", () => {
    renderMenu(person(true));
    expect(screen.getByRole("menuitem", { name: "Khóa chia sẻ màn hình của Lan" })).toBeInTheDocument();
  });

  it("never offers to lock the meeting host's share", () => {
    // Another host (an admin) on the host's tile: the server would answer 409.
    renderMenu(person(false, { identity: "uw_participant_p-host" }));
    expect(screen.getByRole("menuitem", { name: "Khóa mic của Lan" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /chia sẻ màn hình/ })).not.toBeInTheDocument();
  });

  it("holds the share lock back until the host's seats are known", () => {
    // Any tile may be the meeting host's until the list loads (the server answers 409).
    api.participantsLoaded = false;
    renderMenu(person(false, { identity: "uw_participant_p-host" }));
    expect(screen.getByRole("menuitem", { name: "Khóa mic của Lan" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /chia sẻ màn hình/ })).not.toBeInTheDocument();
  });

  it("offers the share lock on a co-host who is not the meeting's host", () => {
    renderMenu(person(false, { identity: "uw_participant_p-cohost" }));
    expect(screen.getByRole("menuitem", { name: "Khóa chia sẻ màn hình của Lan" })).toBeInTheDocument();
  });

  it("offers no share lock on the viewer's own tile", () => {
    renderMenu({ ...person(), isLocal: true } as unknown as Participant);
    expect(screen.queryByRole("menuitem", { name: /chia sẻ màn hình/ })).not.toBeInTheDocument();
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
