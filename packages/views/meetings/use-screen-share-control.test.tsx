import { act, fireEvent, render } from "@testing-library/react";
import { ConnectionState, ParticipantEvent, RoomEvent, Track } from "livekit-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import { wrap } from "../test/api-mock";
import { MeetingPresentingCard, MeetingScreenShareWatcher } from "./meeting-screen-share-notices";
import { screenShareCaptureOptions, useScreenShareControl } from "./use-screen-share-control";

type Handler = (...args: unknown[]) => void;

function emitter() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    handlers,
    on(event: string, fn: Handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: Handler) {
      handlers.get(event)?.delete(fn);
    },
  };
}

const fake = vi.hoisted(() => ({
  share: { enabled: false, captureOptions: undefined as unknown, toggle: (() => {}) as () => void },
  local: null as unknown,
  room: null as unknown as { state: string; localParticipant: unknown },
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => fake.room,
  useLocalParticipant: () => ({ localParticipant: fake.local }),
  useTrackToggle: ({ captureOptions }: { captureOptions?: unknown }) => {
    fake.share.captureOptions = captureOptions;
    return { enabled: fake.share.enabled, pending: false, toggle: fake.share.toggle };
  },
}));

let local: ReturnType<typeof emitter> & {
  permissions: { canPublish: boolean; canPublishSources: number[] };
  setScreenShareEnabled: ReturnType<typeof vi.fn>;
};
let room: ReturnType<typeof emitter> & { state: string; localParticipant: typeof local };

function emit(target: ReturnType<typeof emitter>, event: string, ...args: unknown[]) {
  act(() => target.handlers.get(event)?.forEach((fn) => fn(...args)));
}

/** The host's lock as LiveKit reports it: new sources, then the event. */
function setSources(sources: number[]) {
  local.permissions.canPublishSources = sources;
  emit(local, ParticipantEvent.ParticipantPermissionsChanged);
}

let control: ReturnType<typeof useScreenShareControl>;
function Probe() {
  control = useScreenShareControl();
  return null;
}

function renderRoom() {
  return render(
    wrap(
      <>
        <Probe />
        <MeetingScreenShareWatcher />
      </>,
    ),
  );
}

function settle() {
  act(() => {
    vi.runAllTimers();
  });
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: vi.fn() } });
  local = Object.assign(emitter(), {
    permissions: { canPublish: true, canPublishSources: [] as number[] },
    setScreenShareEnabled: vi.fn(() => Promise.resolve()),
  });
  room = Object.assign(emitter(), { state: ConnectionState.Connected as string, localParticipant: local });
  fake.local = local;
  fake.room = room;
  fake.share.enabled = false;
  fake.share.toggle = vi.fn();
  vi.mocked(toast.info).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("screenShareCaptureOptions", () => {
  it("asks for the shared tab's or the whole system's audio beside the picture", () => {
    // A whole screen only carries sound with system audio (Windows, ChromeOS);
    // restrictOwnAudio keeps the meeting's own playback out of it, or everyone
    // would hear themselves back.
    expect(screenShareCaptureOptions(true)).toEqual({
      selfBrowserSurface: "exclude",
      audio: { restrictOwnAudio: true },
      systemAudio: "include",
    });
  });

  it("asks for no audio when shared audio is not allowed", () => {
    expect(screenShareCaptureOptions(false)).toEqual({ selfBrowserSurface: "exclude", audio: false });
  });
});

describe("useScreenShareControl", () => {
  it("shares audio unless the host's mic lock took it away", () => {
    renderRoom();
    expect(fake.share.captureOptions).toMatchObject({ audio: { restrictOwnAudio: true } });
    // Mic locked: camera and share only — a share with audio would be refused whole.
    setSources([1, 3]);
    expect(fake.share.captureOptions).toMatchObject({ audio: false });
    setSources([]);
    expect(fake.share.captureOptions).toMatchObject({ audio: { restrictOwnAudio: true } });
  });

  it("explains a locked share instead of opening the picker", () => {
    local.permissions.canPublishSources = [1, 2];
    renderRoom();
    expect(control.locked).toBe(true);
    expect(control.label).toBe("Chia sẻ, chủ trì đã khóa");
    act(() => control.toggle());
    expect(fake.share.toggle).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Chủ trì đã khóa chia sẻ màn hình của bạn",
      expect.objectContaining({ id: "meeting-share-notice" }),
    );
  });

  it("announces a lock and its lifting once each", () => {
    const { rerender } = renderRoom();
    setSources([1, 2]);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenLastCalledWith("Chủ trì đã khóa chia sẻ màn hình của bạn", expect.anything());
    rerender(wrap(<Probe />));
    expect(toast.info).toHaveBeenCalledTimes(1);
    setSources([]);
    // Same toast id as the lock notice: its "raise your hand" hint must not
    // stay under the unlock, so the description is cleared, not left out.
    expect(toast.info).toHaveBeenLastCalledWith(
      "Chủ trì đã cho bạn chia sẻ màn hình lại",
      expect.objectContaining({ id: "meeting-share-notice", description: undefined }),
    );
    expect(control.locked).toBe(false);
  });

  it("does not claim the host lifted a lock that a reconnect dropped", () => {
    renderRoom();
    setSources([1, 2]);
    vi.mocked(toast.info).mockClear();
    // A full reconnect re-applies the join grants while the room is still reconnecting.
    room.state = ConnectionState.Reconnecting;
    setSources([]);
    expect(toast.info).not.toHaveBeenCalled();
    expect(control.locked).toBe(false);
  });

  it("says nothing on joining with sharing already locked", () => {
    local.permissions.canPublishSources = [1, 2];
    renderRoom();
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("a share the host stops and locks", () => {
  const share = { source: Track.Source.ScreenShare };

  function sharing() {
    fake.share.enabled = true;
    const view = renderRoom();
    const rerender = () =>
      view.rerender(
        wrap(
          <>
            <Probe />
            <MeetingScreenShareWatcher />
          </>,
        ),
      );
    const stop = () => {
      fake.share.enabled = false;
      rerender();
      emit(room, RoomEvent.LocalTrackUnpublished, share);
    };
    const start = () => {
      fake.share.enabled = true;
      rerender();
    };
    return { stop, start };
  }

  it("is announced once when the lock lands before the stop", () => {
    const { stop } = sharing();
    setSources([1, 2]);
    stop();
    settle();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Chủ trì đã dừng và khóa chia sẻ màn hình của bạn", expect.anything());
  });

  it("is announced once when the stop lands before the lock", () => {
    const { stop } = sharing();
    stop();
    setSources([1, 2]);
    settle();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "Chủ trì đã dừng và khóa chia sẻ màn hình của bạn",
      expect.objectContaining({ id: "meeting-share-notice" }),
    );
  });

  it("does not say the host stopped a share the viewer stopped", () => {
    const { stop } = sharing();
    act(() => control.toggle());
    stop();
    setSources([1, 2]);
    settle();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Chủ trì đã khóa chia sẻ màn hình của bạn", expect.anything());
  });

  it("does not say the host stopped a share the viewer ended from the presenting card", () => {
    const { stop } = sharing();
    const card = render(wrap(<MeetingPresentingCard />));
    fireEvent.click(card.getByRole("button", { name: "Dừng trình bày" }));
    expect(local.setScreenShareEnabled).toHaveBeenCalledWith(false);
    stop();
    setSources([1, 2]);
    settle();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Chủ trì đã khóa chia sẻ màn hình của bạn", expect.anything());
  });

  it("says the host stopped a later share after the viewer ended an earlier one", () => {
    const { stop, start } = sharing();
    act(() => control.toggle());
    stop();
    settle();
    start();
    vi.mocked(toast.info).mockClear();
    stop();
    setSources([1, 2]);
    settle();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Chủ trì đã dừng và khóa chia sẻ màn hình của bạn", expect.anything());
  });

  it("replaces a 'share stopped' notice when the lock lands after it", () => {
    const { stop } = sharing();
    stop();
    settle();
    setSources([1, 2]);
    const ids = vi.mocked(toast.info).mock.calls.map(([, opts]) => (opts as { id?: string } | undefined)?.id);
    // Same id: sonner swaps the notice in place, so only the lock is left on screen.
    expect(ids).toEqual(["meeting-share-notice", "meeting-share-notice"]);
    expect(toast.info).toHaveBeenLastCalledWith("Chủ trì đã dừng và khóa chia sẻ màn hình của bạn", expect.anything());
  });
});
