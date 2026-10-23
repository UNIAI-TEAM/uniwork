import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { toast } from "sonner";
import { forwardRef, useSyncExternalStore, type ComponentProps } from "react";
import { Track, type Participant } from "livekit-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { Toaster } from "@uniwork/ui/components/ui/sonner";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { wrap } from "../test/api-mock";
import { MeetingParticipantTile } from "./meeting-participant-tile";

const connection = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    state: "connected",
    listeners,
    set(next: string) {
      this.state = next;
      for (const fn of listeners) fn();
    },
  };
});

vi.mock("@livekit/components-react", () => ({
  useConnectionState: () =>
    useSyncExternalStore(
      (fn) => {
        connection.listeners.add(fn);
        return () => connection.listeners.delete(fn);
      },
      () => connection.state,
    ),
  isTrackReference: (t: { publication?: unknown } | undefined) => Boolean(t?.publication),
  useConnectionQualityIndicator: () => ({ quality: "excellent" }),
  useIsMuted: () => false,
  useIsSpeaking: () => false,
  useRoomContext: () => ({}),
  useLocalParticipant: () => ({ localParticipant: { setScreenShareEnabled: () => Promise.resolve() } }),
  VideoTrack: forwardRef<HTMLVideoElement, ComponentProps<"video"> & { trackRef?: unknown }>(function VideoTrack(
    { trackRef: _trackRef, ...props },
    ref,
  ) {
    // eslint-disable-next-line jsx-a11y/media-has-caption -- stands in for LiveKit's live track, which has no captions
    return <video ref={ref} data-testid="share-video" {...props} />;
  }),
}));
vi.mock("./use-meeting-signals", () => ({
  useParticipantSignal: () => ({ handRaised: false, reaction: null }),
  useRequestMute: () => vi.fn(),
}));
vi.mock("./meeting-moderation", () => ({
  useMicLocked: () => false,
  MeetingModerationMenuItems: () => null,
  SHARE_NOTICE_TOAST: "meeting-share-notice",
  shareLockedNow: () => false,
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  useMeetingViewSessionStore.getState().reset();
  connection.state = "connected";
});

function shareOf(participant: Participant, capture: { id: string; displaySurface?: string }) {
  const mediaStreamTrack = {
    id: capture.id,
    getSettings: () => (capture.displaySurface ? { displaySurface: capture.displaySurface } : {}),
  };
  return {
    participant,
    source: Track.Source.ScreenShare,
    publication: {
      trackSid: `TR_${capture.id}`,
      isMuted: false,
      dimensions: { width: 1920, height: 1080 },
      track: { mediaStreamTrack },
    },
  } as never;
}

const me = { identity: "uw_participant_me", name: "Quang", isLocal: true } as unknown as Participant;
const lan = { identity: "uw_participant_p1", name: "Lan", isLocal: false } as unknown as Participant;

function renderTile(participant: Participant, track: never) {
  return render(wrap(<MeetingParticipantTile participant={participant} track={track} videoOn />));
}

describe("MeetingParticipantTile, the presenter's own share", () => {
  it("draws a shared tab back at once", () => {
    renderTile(me, shareOf(me, { id: "cap-tab", displaySurface: "browser" }));
    expect(screen.getByTestId("meeting-presenting-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-presenting-card")).not.toBeInTheDocument();
  });

  it("holds a window back behind the card, warned, until asked", () => {
    renderTile(me, shareOf(me, { id: "cap-win", displaySurface: "window" }));
    expect(screen.getByTestId("meeting-presenting-card")).toBeInTheDocument();
    expect(screen.getByText(/Nếu cửa sổ bạn chia sẻ chứa cuộc họp này/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hiện bản xem trước" }));
    expect(screen.getByTestId("meeting-presenting-bar")).toBeInTheDocument();
  });

  it("keeps the choice when LiveKit republishes the same capture under a new sid", () => {
    const { rerender } = renderTile(me, shareOf(me, { id: "cap-win", displaySurface: "window" }));
    fireEvent.click(screen.getByRole("button", { name: "Hiện bản xem trước" }));
    const republished = shareOf(me, { id: "cap-win", displaySurface: "window" }) as unknown as {
      publication: { trackSid: string };
    };
    republished.publication.trackSid = "TR_after_reconnect";
    rerender(wrap(<MeetingParticipantTile participant={me} track={republished as never} videoOn videoTrack={{}} />));
    expect(screen.getByTestId("meeting-presenting-bar")).toBeInTheDocument();
  });

  it("starts a new window share hidden again", () => {
    useMeetingViewSessionStore.getState().setSharePreviewHidden("cap-old", false);
    renderTile(me, shareOf(me, { id: "cap-new", displaySurface: "window" }));
    expect(screen.getByTestId("meeting-presenting-card")).toBeInTheDocument();
  });

  it("never draws a whole screen, and offers no preview", () => {
    renderTile(me, shareOf(me, { id: "cap-screen", displaySurface: "monitor" }));
    expect(screen.getByTestId("meeting-presenting-card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hiện bản xem trước" })).not.toBeInTheDocument();
  });

  it("offers the presenter no full screen of their own share", () => {
    stubElementFullscreen();
    renderTile(me, shareOf(me, { id: "cap-tab", displaySurface: "browser" }));
    expect(screen.queryByRole("button", { name: "Toàn màn hình" })).not.toBeInTheDocument();
  });
});

const restore: Array<() => void> = [];
function stub(target: object, key: string, value: unknown) {
  const own = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restore.push(() => {
    if (own) Object.defineProperty(target, key, own);
    else Reflect.deleteProperty(target, key);
  });
}
afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
});

function stubElementFullscreen() {
  stub(document, "fullscreenEnabled", true);
  stub(document, "fullscreenElement", null);
  stub(
    Element.prototype,
    "requestFullscreen",
    vi.fn(function (this: Element) {
      stub(document, "fullscreenElement", this);
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    }),
  );
  stub(
    document,
    "exitFullscreen",
    vi.fn(() => {
      stub(document, "fullscreenElement", null);
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    }),
  );
}

describe("MeetingParticipantTile, a share watched by someone else", () => {
  it("goes full screen and fills it, then comes back to its size", async () => {
    stubElementFullscreen();
    renderTile(lan, shareOf(lan, { id: "cap-lan" }));
    const enter = screen.getByRole("button", { name: "Toàn màn hình" });
    const tile = enter.closest("[data-tile-controls]")!.parentElement!;
    expect(tile.style.width).not.toBe("");

    await act(async () => {
      fireEvent.click(enter);
    });
    expect(document.fullscreenElement).toBe(tile);
    expect(tile.style.width).toBe("");
    expect(tile).toHaveClass("size-full");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Thoát toàn màn hình" }));
    });
    expect(document.fullscreenElement).toBeNull();
    expect(screen.getByRole("button", { name: "Toàn màn hình" })).toBeInTheDocument();
  });

  it("toggles on a double-click of the shared picture", async () => {
    stubElementFullscreen();
    renderTile(lan, shareOf(lan, { id: "cap-lan" }));
    await act(async () => {
      fireEvent.doubleClick(screen.getByTestId("share-video"));
    });
    expect(screen.getByRole("button", { name: "Thoát toàn màn hình" })).toBeInTheDocument();
  });

  it("steps its controls and name aside while the share plays full screen, back on a move", async () => {
    vi.useFakeTimers();
    try {
      stubElementFullscreen();
      renderTile(lan, shareOf(lan, { id: "cap-lan" }));
      const enter = screen.getByRole("button", { name: "Toàn màn hình" });
      const tile = enter.closest("[data-tile-controls]")!.parentElement!;
      // The pointer is over the tile and the button keeps focus: once the tile
      // fills the screen, neither a pointerleave nor a blur ever comes.
      fireEvent.pointerEnter(tile, { pointerType: "mouse" });
      enter.focus();
      await act(async () => {
        fireEvent.click(enter);
      });
      const controls = () => tile.querySelector("[data-tile-controls]")!;
      const nameChip = screen.getByText("Lan đang trình bày").parentElement!;
      expect(controls()).toHaveClass("opacity-100");

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(controls()).toHaveClass("opacity-0");
      expect(controls()).not.toHaveClass("group-focus-within:opacity-100");
      expect(nameChip).toHaveClass("opacity-0");
      expect(tile).toHaveClass("cursor-none");

      fireEvent.pointerMove(tile, { pointerType: "mouse" });
      expect(controls()).toHaveClass("opacity-100");
      expect(nameChip).not.toHaveClass("opacity-0");

      // A key wakes them too, so a keyboard viewer can find the way out.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      fireEvent.keyDown(document.body, { key: "Tab" });
      expect(controls()).toHaveClass("opacity-100");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Thoát toàn màn hình" }));
      });
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      // Out of full screen the hover rules are back, with no idle hiding.
      expect(controls()).toHaveClass("opacity-100");
      expect(tile).not.toHaveClass("cursor-none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the room's notices inside the full-screen share, which hides the page", async () => {
    stubElementFullscreen();
    // The page's own outlet stays mounted, as apps/web's providers keep it.
    render(wrap(<Toaster />));
    renderTile(lan, shareOf(lan, { id: "cap-lan" }));
    const enter = screen.getByRole("button", { name: "Toàn màn hình" });
    const tile = enter.closest("[data-tile-controls]")!.parentElement!;
    await act(async () => {
      fireEvent.click(enter);
    });
    act(() => {
      toast.info("Người chủ trì đã tắt mic của bạn");
    });
    expect(await within(tile).findByText("Người chủ trì đã tắt mic của bạn")).toBeInTheDocument();
    // Seen in the tile, announced once: only the page's live region is read.
    expect(screen.getAllByRole("region", { name: /Notifications/ })).toHaveLength(1);
    expect(within(tile).getByText("Người chủ trì đã tắt mic của bạn").closest("[aria-hidden]")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Thoát toàn màn hình" }));
    });
    expect(within(tile).queryByText("Người chủ trì đã tắt mic của bạn")).not.toBeInTheDocument();
    act(() => {
      toast.dismiss();
    });
  });

  it("says a reconnect inside the full-screen share, for the eyes only", async () => {
    stubElementFullscreen();
    renderTile(lan, shareOf(lan, { id: "cap-lan" }));
    const enter = screen.getByRole("button", { name: "Toàn màn hình" });
    const tile = enter.closest("[data-tile-controls]")!.parentElement!;
    await act(async () => {
      fireEvent.click(enter);
    });
    expect(within(tile).queryByText("Đang kết nối lại…")).not.toBeInTheDocument();

    act(() => connection.set("reconnecting"));
    const notice = within(tile).getByText("Đang kết nối lại…");
    // The stage's own notice is the one read out; this copy is aria-hidden.
    expect(notice.closest("[aria-hidden]")).not.toBeNull();

    act(() => connection.set("connected"));
    expect(within(tile).queryByText("Đang kết nối lại…")).not.toBeInTheDocument();
  });

  it("hides the button where the browser cannot go full screen", () => {
    stub(document, "fullscreenEnabled", false);
    renderTile(lan, shareOf(lan, { id: "cap-lan" }));
    expect(screen.queryByRole("button", { name: "Toàn màn hình" })).not.toBeInTheDocument();
  });
});
