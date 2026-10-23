import { act, render, screen } from "@testing-library/react";
import { EventEmitter } from "events";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { ParticipantPresenceAnnouncer, ScreenShareAnnouncer } from "./meeting-room-announcers";
import { MeetingStageHeader } from "./meeting-stage-header";

const lk = vi.hoisted(() => ({ room: null as unknown }));

vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => lk.room,
  useParticipants: () => [],
}));

class FakeRoom extends EventEmitter {
  state = ConnectionState.Connected;
  localShare: { source: Track.Source; trackSid: string } | undefined = undefined;
  localParticipant = {
    getTrackPublication: (source: Track.Source) => (source === Track.Source.ScreenShare ? this.localShare : undefined),
  };
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  vi.useFakeTimers();
  lk.room = new FakeRoom();
});

afterEach(() => {
  vi.useRealTimers();
});

const person = (name: string) => ({ identity: `id-${name}`, name });

describe("ParticipantPresenceAnnouncer", () => {
  it("stays quiet for the people already in the room, then says who joined and left", () => {
    render(<ParticipantPresenceAnnouncer />);
    const room = lk.room as FakeRoom;
    const live = screen.getByTestId("meeting-presence-announcer");

    act(() => {
      room.emit(RoomEvent.ParticipantConnected, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      room.emit(RoomEvent.ParticipantConnected, person("Minh"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("Minh đã vào phòng");

    act(() => {
      room.emit(RoomEvent.ParticipantDisconnected, person("Minh"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("Minh đã rời phòng");
  });

  it("reads a burst of arrivals as one count", () => {
    render(<ParticipantPresenceAnnouncer />);
    const room = lk.room as FakeRoom;
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    act(() => {
      for (const name of ["An", "Bình", "Chi"]) room.emit(RoomEvent.ParticipantConnected, person(name));
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("meeting-presence-announcer")).toHaveTextContent("3 người đã vào phòng");
  });
});

describe("ScreenShareAnnouncer", () => {
  const share = { source: Track.Source.ScreenShare, trackSid: "TR_share" };
  const camera = { source: Track.Source.Camera, trackSid: "TR_cam" };

  it("says when someone else starts and stops presenting, not the shares already on", () => {
    render(<ScreenShareAnnouncer />);
    const room = lk.room as FakeRoom;
    const live = screen.getByTestId("meeting-presenting-announcer");
    expect(live).toHaveAttribute("role", "status");

    act(() => {
      room.emit(RoomEvent.TrackPublished, share, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      room.emit(RoomEvent.TrackPublished, camera, person("Minh"));
      room.emit(RoomEvent.TrackPublished, share, person("Minh"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent(/^Minh đã bắt đầu trình bày$/);

    act(() => {
      room.emit(RoomEvent.TrackUnpublished, share, person("Minh"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent(/^Minh đã dừng trình bày$/);
  });

  it("leaves a takeover of our own share to the presenter toast, then says its stop", () => {
    // MeetingSinglePresenter stops our share and its toast says who took over;
    // reading "Lan started presenting" too would say the same thing twice.
    render(<ScreenShareAnnouncer />);
    const room = lk.room as FakeRoom;
    const live = screen.getByTestId("meeting-presenting-announcer");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    room.localShare = { source: Track.Source.ScreenShare, trackSid: "TR_own" };
    act(() => {
      room.emit(RoomEvent.TrackPublished, share, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");

    // Ours gives way (after the race grace): Lan has the stage, the toast said so.
    act(() => {
      room.localShare = undefined;
      room.emit(RoomEvent.LocalTrackUnpublished, { source: Track.Source.ScreenShare, trackSid: "TR_own" });
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");

    // Lan's stop is news to a viewer like any other.
    act(() => {
      room.emit(RoomEvent.TrackUnpublished, share, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent(/^Lan đã dừng trình bày$/);
  });

  it("says nothing of a share that stops ours from inside its own publish", () => {
    // MeetingSinglePresenter listens first and unpublishes ours synchronously,
    // so by the time this announcer hears of Lan's share, ours is gone.
    const room = lk.room as FakeRoom;
    room.on(RoomEvent.TrackPublished, () => {
      if (!room.localShare) return;
      const own = room.localShare;
      room.localShare = undefined;
      room.emit(RoomEvent.LocalTrackUnpublished, own);
    });
    render(<ScreenShareAnnouncer />);
    const live = screen.getByTestId("meeting-presenting-announcer");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    room.localShare = { source: Track.Source.ScreenShare, trackSid: "TR_own" };
    act(() => {
      room.emit(RoomEvent.TrackPublished, share, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");

    act(() => {
      room.emit(RoomEvent.TrackUnpublished, share, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent(/^Lan đã dừng trình bày$/);
  });

  it("swallows the stop of a share that gave way to ours in a race", () => {
    render(<ScreenShareAnnouncer />);
    const room = lk.room as FakeRoom;
    const live = screen.getByTestId("meeting-presenting-announcer");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    room.localShare = { source: Track.Source.ScreenShare, trackSid: "TR_own" };
    act(() => {
      room.emit(RoomEvent.TrackPublished, share, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");

    // Lan's share stops while ours is still on: its start went unsaid.
    act(() => {
      room.emit(RoomEvent.TrackUnpublished, share, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");

    // The next share, with ours off, is news again.
    room.localShare = undefined;
    act(() => {
      room.emit(RoomEvent.TrackPublished, { ...share, trackSid: "TR_share2" }, person("Minh"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent(/^Minh đã bắt đầu trình bày$/);
  });

  it("stays quiet through a reconnect that drops and restores every share", () => {
    render(<ScreenShareAnnouncer />);
    const room = lk.room as FakeRoom;
    const live = screen.getByTestId("meeting-presenting-announcer");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    act(() => {
      room.emit(RoomEvent.TrackUnpublished, share, person("Lan"));
      room.emit(RoomEvent.Reconnecting);
      room.emit(RoomEvent.Reconnected);
      room.emit(RoomEvent.TrackPublished, share, person("Lan"));
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");
  });

  it("stays quiet when the server drops us and the room rejoins in place", () => {
    render(<ScreenShareAnnouncer />);
    const room = lk.room as FakeRoom;
    const live = screen.getByTestId("meeting-presenting-announcer");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    // A server-side leave unpublishes every share while the room still reads
    // Connected, then says Disconnected; room-view rejoins on the same Room.
    act(() => {
      room.emit(RoomEvent.TrackUnpublished, share, person("Lan"));
      room.state = ConnectionState.Disconnected;
      room.emit(RoomEvent.Disconnected);
    });
    act(() => {
      vi.advanceTimersByTime(500);
      room.state = ConnectionState.Connected;
      room.emit(RoomEvent.Connected);
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");
  });
});

describe("MeetingStageHeader recording announcement", () => {
  it("says when recording starts and stops, for everyone in the room", () => {
    vi.useRealTimers();
    const { rerender } = render(wrapWithNav(<MeetingStageHeader meetingTitle="Standup" recording={false} />));
    const live = screen.getByTestId("meeting-recording-announcer");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveTextContent("");

    rerender(wrapWithNav(<MeetingStageHeader meetingTitle="Standup" recording />));
    expect(live).toHaveTextContent("Đã bắt đầu ghi hình");

    rerender(wrapWithNav(<MeetingStageHeader meetingTitle="Standup" recording={false} />));
    expect(live).toHaveTextContent("Đã dừng ghi hình");
  });
});
