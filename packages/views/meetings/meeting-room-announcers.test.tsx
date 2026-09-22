import { act, render, screen } from "@testing-library/react";
import { EventEmitter } from "events";
import { ConnectionState, RoomEvent } from "livekit-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { ParticipantPresenceAnnouncer } from "./meeting-room-announcers";
import { MeetingStageHeader } from "./meeting-stage-header";

const lk = vi.hoisted(() => ({ room: null as unknown }));

vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => lk.room,
  useParticipants: () => [],
}));

class FakeRoom extends EventEmitter {
  state = ConnectionState.Connected;
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
