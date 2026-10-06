import { act, render } from "@testing-library/react";
import { EventEmitter } from "events";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { toast } from "sonner";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingSinglePresenter } from "./meeting-single-presenter";
import { PRESENTER_RACE_GRACE_MS, PRESENTER_RACE_MS } from "./single-presenter";
import { takeScreenShareStopByUser } from "./screen-share";

const lk = vi.hoisted(() => ({ room: null as unknown }));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@livekit/components-react", () => ({ useRoomContext: () => lk.room }));

type Pub = { source: Track.Source; trackSid: string };
const screenShare = (trackSid: string): Pub => ({ source: Track.Source.ScreenShare, trackSid });

class FakeParticipant {
  shares = new Map<Track.Source, Pub>();
  constructor(
    public identity: string,
    public name = "",
  ) {}
  getTrackPublication(source: Track.Source) {
    return this.shares.get(source);
  }
}

class FakeRoom extends EventEmitter {
  state = ConnectionState.Connected;
  remoteParticipants = new Map<string, FakeParticipant>();
  localParticipant = Object.assign(new FakeParticipant("mmm"), {
    setScreenShareEnabled: vi.fn((on: boolean) => {
      if (!on) this.stopOwnShare();
      return Promise.resolve();
    }),
  });
  /** We start sharing: LiveKit publishes, then says so. */
  startOwnShare(sid = "TR_own") {
    const pub = screenShare(sid);
    this.localParticipant.shares.set(Track.Source.ScreenShare, pub);
    this.emit(RoomEvent.LocalTrackPublished, pub, this.localParticipant);
  }
  stopOwnShare() {
    const pub = this.localParticipant.shares.get(Track.Source.ScreenShare);
    this.localParticipant.shares.delete(Track.Source.ScreenShare);
    if (pub) this.emit(RoomEvent.LocalTrackUnpublished, pub, this.localParticipant);
  }
  /** Someone else starts sharing. */
  remoteShare(identity: string, name: string, sid: string) {
    const { p, pub } = this.rosterShare(identity, name, sid);
    this.emit(RoomEvent.TrackPublished, pub, p);
  }
  /** A share already on as we join: LiveKit puts it in the roster without a TrackPublished. */
  rosterShare(identity: string, name: string, sid: string) {
    const p = this.remoteParticipants.get(identity) ?? new FakeParticipant(identity, name);
    this.remoteParticipants.set(identity, p);
    const pub = screenShare(sid);
    p.shares.set(Track.Source.ScreenShare, pub);
    return { p, pub };
  }
  remoteStop(identity: string) {
    const p = this.remoteParticipants.get(identity);
    const pub = p?.shares.get(Track.Source.ScreenShare);
    p?.shares.delete(Track.Source.ScreenShare);
    if (pub) this.emit(RoomEvent.TrackUnpublished, pub, p);
  }
}

const room = () => lk.room as FakeRoom;
const flush = () => act(() => Promise.resolve());

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  lk.room = new FakeRoom();
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MeetingSinglePresenter", () => {
  it("stops our share when someone else starts presenting after us, quietly but for who took over", async () => {
    render(<MeetingSinglePresenter />);
    act(() => room().startOwnShare());
    vi.setSystemTime(100_000 + PRESENTER_RACE_MS + 1_000);
    act(() => room().remoteShare("aaa", "Lan", "TR_lan"));
    await flush();

    expect(room().localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
    // Marked as our own stop, so the generic "share stopped" toast stays quiet.
    expect(takeScreenShareStopByUser(room() as never)).toBe(true);
    expect(toast.info).toHaveBeenCalledWith("Lan đã thay bạn trình bày. Màn hình của bạn không còn được chia sẻ.");
  });

  it("keeps presenting when ours is the newer share: the other presenter gives way", async () => {
    room().remoteShare("zzz", "Minh", "TR_minh");
    render(<MeetingSinglePresenter />);
    vi.setSystemTime(100_000 + 500);
    act(() => room().startOwnShare());
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it("settles a near-simultaneous start the same way on both sides", async () => {
    // We ("mmm") start; "zzz" starts a second later. The greater identity keeps
    // presenting, and ours stops once the grace shows "zzz" did not stop first.
    render(<MeetingSinglePresenter />);
    act(() => room().startOwnShare());
    vi.setSystemTime(101_000);
    act(() => room().remoteShare("zzz", "Minh", "TR_minh"));
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(PRESENTER_RACE_GRACE_MS);
    });
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
    takeScreenShareStopByUser(room() as never);

    // Against "aaa" in the same race we are the one that stays.
    lk.room = new FakeRoom();
    render(<MeetingSinglePresenter />);
    act(() => room().remoteShare("aaa", "Lan", "TR_lan"));
    vi.setSystemTime(101_500);
    act(() => room().startOwnShare());
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it("keeps presenting when the other side of a near-edge race stopped first", async () => {
    // "zzz" started 2.9 s before us and, with its own network delay, read our
    // share as a takeover and stopped. We read a race lost on identity, so we
    // wait, see the share gone, and stay: never both off.
    render(<MeetingSinglePresenter />);
    act(() => room().remoteShare("zzz", "Minh", "TR_minh"));
    vi.setSystemTime(102_900);
    act(() => room().startOwnShare());
    vi.setSystemTime(103_300);
    act(() => room().remoteStop("zzz"));
    act(() => {
      vi.advanceTimersByTime(PRESENTER_RACE_GRACE_MS);
    });
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it("takes over a share that was on before we joined, whatever the identities", async () => {
    // LiveKitRoom renders us before the room connects: the roster is empty at
    // mount, then arrives without a TrackPublished for the share already on.
    room().state = ConnectionState.Connecting;
    render(<MeetingSinglePresenter />);
    room().rosterShare("zzz", "Minh", "TR_minh");
    room().state = ConnectionState.Connected;
    act(() => {
      room().emit(RoomEvent.Connected);
    });
    vi.setSystemTime(100_000 + PRESENTER_RACE_MS + 500);
    act(() => room().startOwnShare());
    act(() => {
      vi.advanceTimersByTime(PRESENTER_RACE_GRACE_MS);
    });
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it("keeps presenting when we take over right after joining: the old share gives way first", async () => {
    // We cannot tell how long "zzz" has been on, so a start this soon after
    // joining reads as a race we lose on identity. "zzz", who saw ours arrive
    // long after its own, reads a takeover and stops within the grace.
    room().state = ConnectionState.Connecting;
    render(<MeetingSinglePresenter />);
    room().rosterShare("zzz", "Minh", "TR_minh");
    room().state = ConnectionState.Connected;
    act(() => {
      room().emit(RoomEvent.Connected);
    });
    vi.setSystemTime(100_200);
    act(() => room().startOwnShare());
    vi.setSystemTime(100_400);
    act(() => room().remoteStop("zzz"));
    act(() => {
      vi.advanceTimersByTime(PRESENTER_RACE_GRACE_MS);
    });
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it("settles a share started just before we joined by identity, as its presenter does", async () => {
    // "zzz" started half a second before we connected and sees ours 2 s after
    // its own: a race it wins on identity. We must read the same race, not a
    // share infinitely older than ours, or both stay on.
    vi.setSystemTime(99_500);
    room().state = ConnectionState.Connecting;
    render(<MeetingSinglePresenter />);
    room().rosterShare("zzz", "Minh", "TR_minh");
    vi.setSystemTime(100_000);
    room().state = ConnectionState.Connected;
    act(() => {
      room().emit(RoomEvent.Connected);
    });
    vi.setSystemTime(102_000);
    act(() => room().startOwnShare());
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(PRESENTER_RACE_GRACE_MS);
    });
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
    takeScreenShareStopByUser(room() as never);

    // Against "aaa" in the same spot we win the race and stay.
    lk.room = new FakeRoom();
    room().state = ConnectionState.Connecting;
    render(<MeetingSinglePresenter />);
    room().rosterShare("aaa", "Lan", "TR_lan");
    room().state = ConnectionState.Connected;
    act(() => {
      room().emit(RoomEvent.Connected);
    });
    vi.setSystemTime(104_000);
    act(() => room().startOwnShare());
    act(() => {
      vi.advanceTimersByTime(PRESENTER_RACE_GRACE_MS);
    });
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it("keeps the start of our share across a language switch", async () => {
    const i18n = initI18n();
    render(<MeetingSinglePresenter />);
    act(() => room().startOwnShare());
    vi.setSystemTime(103_000);
    await act(() => i18n.changeLanguage("en"));
    try {
      // "aaa" starts more than the race after us: a takeover, not a race we win.
      vi.setSystemTime(100_000 + PRESENTER_RACE_MS + 1_000);
      act(() => room().remoteShare("aaa", "Lan", "TR_lan"));
      await flush();
      expect(room().localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
      expect(toast.info).toHaveBeenCalledWith("Lan took over presenting. Your screen is no longer shared.");
    } finally {
      await act(() => i18n.changeLanguage("vi"));
    }
  });

  it("starts our share afresh after a drop and a rejoin on the same room", async () => {
    render(<MeetingSinglePresenter />);
    act(() => room().startOwnShare());
    // The reconnect fails: LiveKit unpublishes our share while still Reconnecting.
    room().state = ConnectionState.Reconnecting;
    act(() => room().stopOwnShare());
    room().state = ConnectionState.Disconnected;
    act(() => {
      room().emit(RoomEvent.Disconnected);
    });
    // room-view rejoins in place: Connected, not Reconnected.
    vi.setSystemTime(160_000);
    room().state = ConnectionState.Connected;
    act(() => {
      room().emit(RoomEvent.Connected);
    });
    act(() => room().remoteShare("aaa", "Lan", "TR_lan"));
    vi.setSystemTime(160_000 + PRESENTER_RACE_MS + 1_000);
    act(() => room().startOwnShare("TR_own2"));
    act(() => {
      vi.advanceTimersByTime(PRESENTER_RACE_GRACE_MS);
    });
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it("does nothing while we are not presenting, nor once we have left", async () => {
    const { unmount } = render(<MeetingSinglePresenter />);
    act(() => room().remoteShare("aaa", "Lan", "TR_lan"));
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();

    act(() => room().startOwnShare());
    unmount();
    vi.setSystemTime(200_000);
    act(() => room().remoteShare("bbb", "Hoa", "TR_hoa"));
    await flush();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("clears its stop mark and says so when the share will not stop", async () => {
    render(<MeetingSinglePresenter />);
    act(() => room().startOwnShare());
    room().localParticipant.setScreenShareEnabled.mockRejectedValueOnce(new Error("busy"));
    vi.setSystemTime(200_000);
    act(() => room().remoteShare("aaa", "Lan", "TR_lan"));
    await flush();
    expect(takeScreenShareStopByUser(room() as never)).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
