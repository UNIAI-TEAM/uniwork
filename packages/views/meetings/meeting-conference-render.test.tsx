import { act, render, screen } from "@testing-library/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { RoomEvent, Track } from "livekit-client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { MeetingConference } from "./meeting-conference";

/**
 * Render scoping in a room: a speaking change (the most frequent LiveKit
 * event) repaints the tiles and nothing around them.
 */
const lk = vi.hoisted(() => {
  let speaking: { identity: string }[] = [];
  const listeners = new Set<() => void>();
  return {
    tracksCalls: [] as unknown[][],
    renders: { header: 0, sidebar: 0, controlBar: 0, tiles: new Map<string, number>() },
    speaking: {
      get: () => speaking,
      set: (ids: string[]) => {
        speaking = ids.map((identity) => ({ identity }));
        for (const l of listeners) l();
      },
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
  };
});

function camera(identity: string) {
  return {
    participant: { identity, name: identity, isLocal: false },
    source: "camera",
    publication: { track: {}, isMuted: false, trackSid: `TR_${identity}` },
  };
}
const room = Array.from({ length: 9 }, (_, i) => camera(`p${i}`));

vi.mock("@livekit/components-react", () => {
  return {
    RoomAudioRenderer: () => null,
    StartMediaButton: () => null,
    useIsRecording: () => false,
    useSpeakingParticipants: () => useSyncExternalStore(lk.speaking.subscribe, lk.speaking.get),
    useTracks: (...args: unknown[]) => {
      lk.tracksCalls.push(args);
      return room;
    },
    isTrackReference: (t: { publication?: unknown }) => Boolean(t.publication),
  };
});
vi.mock("./use-meeting-signals", () => ({
  MeetingSignalsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./meeting-room-avatars", () => ({
  MeetingRoomAvatarsProvider: ({ children }: { children: ReactNode }) => children,
  useRoomAvatarOf: () => () => undefined,
}));
vi.mock("./meeting-stage-header", async () => {
  const { memo } = await import("react");
  return {
    MeetingStageHeader: memo(function Header() {
      lk.renders.header += 1;
      return null;
    }),
  };
});
vi.mock("./meeting-room-sidebar", () => ({
  MeetingRoomSidebar: function Sidebar() {
    lk.renders.sidebar += 1;
    return null;
  },
  MeetingSidebarDock: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./meeting-control-bar", async () => {
  const { memo } = await import("react");
  return {
    MeetingControlBar: memo(function ControlBar() {
      lk.renders.controlBar += 1;
      return null;
    }),
  };
});
vi.mock("./meeting-stage-footer", () => ({
  MeetingStageFooter: ({ controlBar }: { controlBar: ReactNode }) => controlBar,
}));
vi.mock("./meeting-participant-tile", async () => {
  const { memo } = await import("react");
  return {
    MeetingParticipantTile: memo(function Tile({ participant }: { participant: { identity: string } }) {
      lk.renders.tiles.set(participant.identity, (lk.renders.tiles.get(participant.identity) ?? 0) + 1);
      return <div data-testid="tile">{participant.identity}</div>;
    }),
  };
});
vi.mock("./meeting-room-announcers", () => ({
  ChatMessageAnnouncer: () => null,
  ParticipantPresenceAnnouncer: () => null,
  ReactionAnnouncer: () => null,
  useMeetingChatUnread: () => ({ unread: 0, latest: undefined }),
}));
vi.mock("./meeting-captions", () => ({
  captionsErrorKey: (c: string) => c,
  captionsSupported: () => false,
  MeetingLiveCaptions: () => null,
}));
vi.mock("./meeting-camera-background-sync", () => ({ MeetingCameraBackgroundSync: () => null }));
vi.mock("./meeting-screen-share-notices", () => ({ MeetingScreenShareWatcher: () => null }));
vi.mock("./meeting-connection-notice", () => ({ MeetingConnectionNotice: () => null }));
vi.mock("./meeting-schedule-banner", () => ({ MeetingScheduleBanner: () => null }));
vi.mock("./meeting-vote-prompt", () => ({ MeetingVotePrompt: () => null }));

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  lk.tracksCalls = [];
  lk.renders = { header: 0, sidebar: 0, controlBar: 0, tiles: new Map() };
  act(() => lk.speaking.set([]));
});

function tileOrder(): string[] {
  return screen.getAllByTestId("tile").map((el) => el.textContent ?? "");
}

describe("MeetingConference render scoping", () => {
  it("follows only the track events that change a tile", () => {
    render(wrapWithNav(<MeetingConference meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    const [sources, options] = lk.tracksCalls[0] as [unknown, Record<string, unknown>];
    expect(sources).toEqual([
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ]);
    expect(options).toEqual({
      onlySubscribed: true,
      updateOnlyOn: [RoomEvent.TrackMuted, RoomEvent.TrackUnmuted],
    });
  });

  it("repaints the tiles on a speaking change, and not the header, side panel or control bar", () => {
    render(wrapWithNav(<MeetingConference meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    const before = { ...lk.renders, tiles: new Map(lk.renders.tiles) };
    const tracksBefore = lk.tracksCalls.length;

    act(() => lk.speaking.set(["p2"]));
    act(() => lk.speaking.set(["p3"]));
    act(() => lk.speaking.set([]));

    // The tile leaf did re-render (it reads the speakers)...
    expect(lk.tracksCalls.length).toBeGreaterThan(tracksBefore);
    // ...and nothing around it did.
    expect(lk.renders.header).toBe(before.header);
    expect(lk.renders.sidebar).toBe(before.sidebar);
    expect(lk.renders.controlBar).toBe(before.controlBar);
    // Speakers already on stage stay put: no tile was repainted.
    expect(lk.renders.tiles).toEqual(before.tiles);
  });

  it("swaps one speaker in from the strip, leaving the other tiles in place", () => {
    render(wrapWithNav(<MeetingConference meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
    expect(tileOrder()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
    act(() => lk.speaking.set(["p8"]));
    // p8 takes the last quiet main slot; p5 goes to where p8 was.
    expect(tileOrder()).toEqual(["p0", "p1", "p2", "p3", "p4", "p8", "p6", "p7", "p5"]);
    // p8 stops as p7 starts: p8 is held in place, so p7 takes the next quiet slot.
    act(() => lk.speaking.set(["p7"]));
    expect(tileOrder()).toEqual(["p0", "p1", "p2", "p3", "p7", "p8", "p6", "p4", "p5"]);
  });
});
