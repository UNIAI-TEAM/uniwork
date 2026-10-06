import { act, fireEvent, render, screen } from "@testing-library/react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import { wrap } from "../test/api-mock";
import { MeetingPresentingBar, MeetingPresentingCard, MeetingScreenShareWatcher } from "./meeting-screen-share-notices";
import { markScreenShareStopByUser } from "./screen-share";

type Handler = (...args: unknown[]) => void;

const fake = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    handlers,
    room: {
      state: "connected",
      localParticipant: { permissions: undefined },
      on(event: string, fn: (...args: unknown[]) => void) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(fn);
      },
      off(event: string, fn: (...args: unknown[]) => void) {
        handlers.get(event)?.delete(fn);
      },
    },
    setScreenShareEnabled: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("sonner", () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => fake.room,
  useLocalParticipant: () => ({ localParticipant: { setScreenShareEnabled: fake.setScreenShareEnabled } }),
}));

function emit(event: string, ...args: unknown[]) {
  act(() => fake.handlers.get(event)?.forEach((fn: Handler) => fn(...args)));
}

/** The watcher reads the room state once LiveKit's synchronous teardown has run. */
function settle() {
  act(() => {
    vi.runAllTimers();
  });
}

const share = { source: Track.Source.ScreenShare };

beforeAll(() => {
  initI18n();
});

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  fake.handlers.clear();
  fake.room.state = ConnectionState.Connected;
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.warning).mockClear();
});

describe("MeetingScreenShareWatcher", () => {
  it("says so when a share ends without the viewer's own control", () => {
    render(wrap(<MeetingScreenShareWatcher />));
    emit(RoomEvent.LocalTrackUnpublished, { source: Track.Source.Camera });
    settle();
    expect(toast.info).not.toHaveBeenCalled();
    emit(RoomEvent.LocalTrackUnpublished, share);
    settle();
    expect(toast.info).toHaveBeenCalledWith("Đã dừng chia sẻ màn hình.", expect.anything());
  });

  it("stays quiet for a stop the viewer asked for", () => {
    render(wrap(<MeetingScreenShareWatcher />));
    markScreenShareStopByUser(fake.room as never);
    emit(RoomEvent.LocalTrackUnpublished, share);
    settle();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("says nothing when the viewer leaves (or is ended) while sharing", () => {
    render(wrap(<MeetingScreenShareWatcher />));
    // LiveKit unpublishes while the room still reads Connected, then flips it.
    emit(RoomEvent.LocalTrackUnpublished, share);
    fake.room.state = ConnectionState.Disconnected;
    settle();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("forgets a loss that LiveKit's own reconnect repaired", () => {
    render(wrap(<MeetingScreenShareWatcher />));
    fake.room.state = ConnectionState.Reconnecting;
    emit(RoomEvent.LocalTrackUnpublished, share);
    settle();
    emit(RoomEvent.Reconnected);
    fake.room.state = ConnectionState.Connected;
    emit(RoomEvent.Connected);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("explains a share lost with the connection once the room is back, not on the way out", () => {
    render(wrap(<MeetingScreenShareWatcher />));
    fake.room.state = ConnectionState.Disconnected;
    emit(RoomEvent.LocalTrackUnpublished, share);
    settle();
    expect(toast.warning).not.toHaveBeenCalled();
    fake.room.state = ConnectionState.Connected;
    emit(RoomEvent.Connected);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/kết nối bị gián đoạn/));
    emit(RoomEvent.Connected);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

describe("MeetingPresentingCard", () => {
  it("replaces the presenter's own screen with a way to stop", () => {
    render(wrap(<MeetingPresentingCard />));
    expect(screen.getByText("Bạn đang trình bày cho mọi người")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dừng trình bày" }));
    expect(fake.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });
});

describe("MeetingPresentingBar", () => {
  it("says the preview is live, puts it away, and stops the share", () => {
    const onHidePreview = vi.fn();
    render(wrap(<MeetingPresentingBar onHidePreview={onHidePreview} />));
    expect(screen.getByText("Bạn đang trình bày")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ẩn bản xem trước" }));
    expect(onHidePreview).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Dừng trình bày" }));
    expect(fake.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });

  it("keeps a thumbnail to a label", () => {
    render(wrap(<MeetingPresentingBar compact onHidePreview={() => {}} />));
    expect(screen.getByText("Bạn đang trình bày")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("MeetingPresentingCard with a hidden preview", () => {
  it("offers the preview back and says the room still sees the share", () => {
    const onShowPreview = vi.fn();
    render(wrap(<MeetingPresentingCard onShowPreview={onShowPreview} />));
    expect(screen.getByText(/Bản xem trước chỉ ẩn trên máy bạn/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hiện bản xem trước" }));
    expect(onShowPreview).toHaveBeenCalledOnce();
  });
  it("warns a window's presenter that the preview can mirror the meeting for everyone", () => {
    render(wrap(<MeetingPresentingCard windowShare onShowPreview={() => {}} />));
    expect(screen.getByText(/Nếu cửa sổ bạn chia sẻ chứa cuộc họp này/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hiện bản xem trước" })).toBeInTheDocument();
  });
});
