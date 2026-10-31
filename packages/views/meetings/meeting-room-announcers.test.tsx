import { act, render, screen } from "@testing-library/react";
import { EventEmitter } from "events";
import { ConnectionState, ParticipantKind, RoomEvent, Track } from "livekit-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { ParticipantPresenceAnnouncer, ScreenShareAnnouncer, ScribeAnnouncer } from "./meeting-room-announcers";
import { MeetingStageHeader } from "./meeting-stage-header";

const lk = vi.hoisted(() => ({
  room: null as unknown,
  remote: [] as { identity: string; isAgent?: boolean; attributes?: Record<string, string> }[],
}));

vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => lk.room,
  useParticipants: () => [],
  useRemoteParticipants: () => lk.remote,
  useConnectionState: () => ConnectionState.Connected,
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
  lk.remote = [];
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

  it("never announces the AI scribe joining", () => {
    render(<ParticipantPresenceAnnouncer />);
    const room = lk.room as FakeRoom;
    const live = screen.getByTestId("meeting-presence-announcer");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    act(() => {
      room.emit(RoomEvent.ParticipantConnected, { identity: "uw_agent_scribe", name: "UniWork AI", isAgent: true });
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");
  });

  it("announces a phone caller once the host admits them, never while held", () => {
    render(<ParticipantPresenceAnnouncer />);
    const room = lk.room as FakeRoom;
    const live = screen.getByTestId("meeting-presence-announcer");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    // Held callers join with no attribute, then "waiting"; neither is news.
    const caller = { identity: "sip_1", name: "0912 345 678", kind: ParticipantKind.SIP, attributes: {} };
    act(() => {
      room.emit(RoomEvent.ParticipantConnected, caller);
      caller.attributes = { "uw.dial_in": "waiting" };
      room.emit(RoomEvent.ParticipantAttributesChanged, { "uw.dial_in": "waiting" }, caller);
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("");
    act(() => {
      caller.attributes = { "uw.dial_in": "admitted" };
      room.emit(RoomEvent.ParticipantAttributesChanged, { "uw.dial_in": "admitted" }, caller);
      vi.advanceTimersByTime(1500);
    });
    expect(live).toHaveTextContent("0912 345 678 đã vào phòng");
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

describe("ScribeAnnouncer", () => {
  it("says when the AI scribe starts and stops transcribing, as the recording announcer does", () => {
    vi.useRealTimers();
    const { rerender } = render(<ScribeAnnouncer />);
    const live = screen.getByTestId("meeting-scribe-announcer");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveTextContent("");

    lk.remote = [{ identity: "uw_agent_scribe", isAgent: true }];
    rerender(<ScribeAnnouncer />);
    expect(live).toHaveTextContent("Thư ký UNI đang ghi lời");

    lk.remote = [];
    rerender(<ScribeAnnouncer />);
    expect(live).toHaveTextContent("Thư ký UNI đã dừng ghi lời");
  });

  it("says when the scribe pauses on an STT outage and when it is back", () => {
    vi.useRealTimers();
    const meeting = { scribe_enabled: true };
    lk.remote = [{ identity: "uw_agent_scribe", isAgent: true }];
    const { rerender } = render(<ScribeAnnouncer meeting={meeting} />);
    const live = screen.getByTestId("meeting-scribe-announcer");
    lk.remote = [{ identity: "uw_agent_scribe", isAgent: true, attributes: { "uw.scribe_state": "degraded" } }];
    rerender(<ScribeAnnouncer meeting={meeting} />);
    expect(live).toHaveTextContent("Thư ký UNI tạm dừng, đang thử lại");
    lk.remote = [{ identity: "uw_agent_scribe", isAgent: true, attributes: { "uw.scribe_state": "ok" } }];
    rerender(<ScribeAnnouncer meeting={meeting} />);
    expect(live).toHaveTextContent("Thư ký UNI đang ghi lời");
  });

  it("tells the room once when the scribe's status turns FAILED", () => {
    vi.useRealTimers();
    const { rerender } = render(<ScribeAnnouncer meeting={{ scribe_enabled: true, scribe_status: "JOINING" }} />);
    const live = screen.getByTestId("meeting-scribe-announcer");
    expect(live).toHaveTextContent("");
    rerender(<ScribeAnnouncer meeting={{ scribe_enabled: true, scribe_status: "FAILED" }} />);
    expect(live).toHaveTextContent("Thư ký UNI gặp sự cố nên không ghi lời thoại");
    // Turned off by the host: no longer a failure, and nothing new to say.
    rerender(<ScribeAnnouncer meeting={{ scribe_enabled: false, scribe_status: "FAILED" }} />);
    expect(live).toHaveTextContent("Thư ký UNI gặp sự cố nên không ghi lời thoại");
  });
});

describe("MeetingStageHeader remaining time (UNI-2285 E)", () => {
  it("remaining time renders through NumberFlow", () => {
    vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
    const meeting = {
      id: "m1",
      workspace_id: "w1",
      title: "Standup",
      description: "",
      starts_at: "2026-10-29T09:30:00Z",
      ends_at: "2026-10-29T10:59:41Z",
      room_name: "uw_mtg_m1",
      created_by: "u1",
      status: "IN_PROGRESS" as const,
    };
    render(wrapWithNav(<MeetingStageHeader meeting={meeting} />));
    const chip = screen.getByTestId("meeting-remaining-time");
    // Hours, minutes and seconds each roll on their own.
    expect(chip.querySelectorAll("number-flow-react")).toHaveLength(3);
    expect(chip).toHaveTextContent("00:59:41 còn lại");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(chip).toHaveTextContent("00:59:40 còn lại");
  });
});

