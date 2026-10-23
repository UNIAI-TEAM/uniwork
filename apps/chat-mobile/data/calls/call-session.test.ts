// The system's call UI's buttons carried out by the app (call-session.ts) and the engine's calls told to it
// (call-session-sync.ts), with the session, the engine, the link opener and WebRTC stood in for.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import type { CallSessionEvent } from "@/lib/call-session-event";

const rtc = vi.hoisted(() => ({ audioSessionDidActivate: vi.fn(), audioSessionDidDeactivate: vi.fn() }));
vi.mock("@livekit/react-native-webrtc", () => ({ RTCAudioSession: rtc }));
vi.mock("../auth/flow", () => ({ authConfig: { scheme: "uniworkchat" } }));
const wiring = vi.hoisted(() => ({ runCallActionTask: vi.fn(async () => undefined) }));
vi.mock("./call-wiring", () => wiring);

const session = vi.hoisted(() => ({
  listener: null as ((event: CallSessionEvent) => void) | null,
  pending: [] as CallSessionEvent[],
  off: vi.fn(),
  answered: vi.fn(),
  declined: vi.fn(),
  ended: vi.fn(),
}));
vi.mock("./native-call-session", () => ({
  nativeCallSession: {
    subscribe: (listener: (event: CallSessionEvent) => void) => {
      session.listener = listener;
      return session.off;
    },
    takePending: () => session.pending.splice(0),
    answered: session.answered,
    declined: session.declined,
    ended: session.ended,
  },
}));
const engine = vi.hoisted(() => ({ store: null as unknown as StoreApi<{ call: VoiceCallOverlayState }> }));
vi.mock("./call-store", async () => {
  const { createStore } = await import("zustand/vanilla");
  engine.store = createStore<{ call: VoiceCallOverlayState }>(() => ({ call: { status: "idle" } }));
  return { callEngine: { store: engine.store } };
});

const { handleSessionEvent, startCallSession, startNativeCallSession } = await import("./call-session");
const { syncCallSession } = await import("./call-session-sync");

const CALL = { callId: "c-1", roomId: "r-1", workspaceId: "w-1", orgSlug: "acme", wsSlug: "hq", callerName: "Minh", video: false };
const LINK = `uniworkchat://open?url=${encodeURIComponent("/acme/hq/chat?room=r-1&call=c-1")}`;

function env() {
  return {
    session: {
      subscribe: vi.fn((_listener: (event: CallSessionEvent) => void): (() => void) => vi.fn()),
      takePending: vi.fn((): CallSessionEvent[] => []),
    },
    scheme: "uniworkchat",
    openUrl: vi.fn(),
    runAction: vi.fn(async () => undefined),
    audio: { activate: vi.fn(), deactivate: vi.fn() },
    now: () => 1_000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  session.pending = [];
  session.listener = null;
  engine.store.setState({ call: { status: "idle" } });
});

describe("handleSessionEvent", () => {
  it("opens the answered call's room with the call, which the Chat tab answers", () => {
    const e = env();
    handleSessionEvent({ type: "answered", call: CALL }, e);
    expect(e.openUrl).toHaveBeenCalledWith(LINK);
  });

  it("opens nothing for an answered call whose push named no room", () => {
    const e = env();
    handleSessionEvent({ type: "answered", call: { ...CALL, roomId: "" } }, e);
    expect(e.openUrl).not.toHaveBeenCalled();
  });

  it("declines through the notification's Decline task, for a decline and for an end alike", () => {
    const e = env();
    handleSessionEvent({ type: "declined", call: CALL }, e);
    handleSessionEvent({ type: "ended", call: CALL }, e);
    const action = { action: "decline", callId: "c-1", roomId: "r-1", workspaceId: "w-1", callKind: "", at: 1_000 };
    expect(e.runAction.mock.calls).toEqual([[action], [action]]);
  });

  it("tells WebRTC when CallKit activates and releases the audio session", () => {
    const e = env();
    handleSessionEvent({ type: "audio", active: true }, e);
    handleSessionEvent({ type: "audio", active: false }, e);
    expect(e.audio.activate).toHaveBeenCalledTimes(1);
    expect(e.audio.deactivate).toHaveBeenCalledTimes(1);
  });

  it("leaves the token, mute and hold to their own listeners", () => {
    const e = env();
    handleSessionEvent({ type: "token", token: "ab" }, e);
    handleSessionEvent({ type: "muted", callId: "c-1", muted: true }, e);
    handleSessionEvent({ type: "held", callId: "c-1", held: true }, e);
    expect(e.openUrl).not.toHaveBeenCalled();
    expect(e.runAction).not.toHaveBeenCalled();
    expect(e.audio.activate).not.toHaveBeenCalled();
  });
});

describe("startCallSession", () => {
  it("listens before it takes the events that came first, and handles both", () => {
    const e = env();
    const order: string[] = [];
    let listener: (event: CallSessionEvent) => void = () => undefined;
    const off = vi.fn();
    e.session.subscribe.mockImplementation((next: (event: CallSessionEvent) => void) => {
      order.push("subscribe");
      listener = next;
      return off;
    });
    e.session.takePending.mockImplementation(() => {
      order.push("take");
      return [{ type: "answered", call: CALL }];
    });
    const stop = startCallSession(e);
    expect(order).toEqual(["subscribe", "take"]);
    expect(e.openUrl).toHaveBeenCalledWith(LINK);
    listener({ type: "declined", call: CALL });
    expect(e.runAction).toHaveBeenCalledTimes(1);
    stop();
    expect(off).toHaveBeenCalled();
  });
});

describe("startNativeCallSession", () => {
  it("wires the real session, engine, link opener, Decline task and WebRTC, and undoes it", async () => {
    session.pending = [{ type: "audio", active: true }];
    const openUrl = vi.fn();
    const stop = startNativeCallSession(openUrl);
    expect(rtc.audioSessionDidActivate).toHaveBeenCalled();
    session.listener?.({ type: "audio", active: false });
    expect(rtc.audioSessionDidDeactivate).toHaveBeenCalled();
    session.listener?.({ type: "answered", call: CALL });
    expect(openUrl).toHaveBeenCalledWith(LINK);
    session.listener?.({ type: "declined", call: CALL });
    expect(wiring.runCallActionTask).toHaveBeenCalledWith(expect.objectContaining({ action: "decline", callId: "c-1" }));
    const incoming: VoiceCallOverlayState = { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" };
    engine.store.setState({ call: incoming });
    engine.store.setState({ call: { status: "connecting", callId: "c-1", roomId: "r-1", peerName: "Minh", outgoing: false, callKind: "dm" } });
    expect(session.answered).toHaveBeenCalledWith("c-1");
    stop();
    expect(session.off).toHaveBeenCalled();
    engine.store.setState({ call: { status: "idle" } });
    expect(session.ended).not.toHaveBeenCalled();
  });
});

describe("syncCallSession", () => {
  const sys = () => ({ answered: vi.fn(), declined: vi.fn(), ended: vi.fn() });
  const incoming = (callId = "c-1"): VoiceCallOverlayState => ({ status: "incoming", callId, roomId: "r-1", peerName: "Minh", callKind: "dm" });
  const connecting = (callId = "c-1"): VoiceCallOverlayState => ({ status: "connecting", callId, roomId: "r-1", peerName: "Minh", outgoing: false, callKind: "dm" });
  const active: VoiceCallOverlayState = { status: "active", callId: "c-1", roomId: "r-1", peerName: "Minh", token: "t", url: "u", outgoing: false, callKind: "dm" };
  const ended: VoiceCallOverlayState = { status: "ended", reason: "declined", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm", outgoing: false };

  it("tells the system a ringing call was answered here once it starts connecting", () => {
    const s = sys();
    syncCallSession(s, connecting(), incoming());
    expect(s.answered).toHaveBeenCalledWith("c-1");
    syncCallSession(s, active, connecting());
    expect(s.answered).toHaveBeenCalledTimes(1);
    expect(s.ended).not.toHaveBeenCalled();
  });

  it("tells it a ringing call was declined (or rang out, or went elsewhere) when it stops being live", () => {
    const s = sys();
    syncCallSession(s, ended, incoming());
    syncCallSession(s, { status: "idle" }, incoming("c-2"));
    expect(s.declined.mock.calls).toEqual([["c-1"], ["c-2"]]);
  });

  it("tells it a call under way ended, or gave way to another call", () => {
    const s = sys();
    syncCallSession(s, ended, active);
    syncCallSession(s, incoming("c-2"), connecting());
    expect(s.ended.mock.calls).toEqual([["c-1"], ["c-1"]]);
  });

  it("says nothing when no call was live, or the same call merely changes state", () => {
    const s = sys();
    syncCallSession(s, incoming(), { status: "idle" });
    syncCallSession(s, { status: "idle" }, ended);
    syncCallSession(s, incoming(), incoming());
    expect([...s.answered.mock.calls, ...s.declined.mock.calls, ...s.ended.mock.calls]).toEqual([]);
  });
});
