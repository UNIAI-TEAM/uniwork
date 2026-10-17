// The web's use-native-voice-call.test.tsx cases, run against the store, plus
// what the phone adds: a start that fails, the hang-up button, a disconnect,
// and answering from a push.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE_CALL_CONNECTING_TIMEOUT_MS, VOICE_CALL_ENDED_DISMISS_MS, VOICE_CALL_RING_TIMEOUT_MS } from "@/lib/voice-call";
import { createCallEngine, type CallEngineDeps } from "./call-engine";

let pendingInvites: Awaited<ReturnType<CallEngineDeps["pending"]>> = [];

function setup(overrides: Partial<CallEngineDeps> = {}) {
  const deps = {
    invite: vi.fn<CallEngineDeps["invite"]>().mockResolvedValue(true),
    accept: vi.fn<CallEngineDeps["accept"]>().mockResolvedValue(true),
    hangup: vi.fn<CallEngineDeps["hangup"]>().mockResolvedValue(true),
    pending: vi.fn<CallEngineDeps["pending"]>(async () => pendingInvites),
    mintToken: vi.fn<CallEngineDeps["mintToken"]>().mockResolvedValue({ token: "tok", url: "wss://lk" }),
    createCallId: vi.fn(() => "new-call"),
    ...overrides,
  };
  const engine = createCallEngine(deps);
  engine.configure({ wsId: "ws1", userId: "me", allowedRoomIds: () => new Set(["room-dm", "room-other"]) });
  return { engine, deps, call: () => engine.store.getState().call };
}

const invite = (over: Record<string, string | undefined> = {}) => ({
  room_id: "room-dm",
  call_id: "c1",
  caller_id: "peer",
  caller_name: "Long",
  target_user_id: "me",
  call_kind: "dm",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  pendingInvites = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("call engine (use-native-voice-call parity)", () => {
  it("hangs up an outgoing call nobody answers and says so", async () => {
    const { engine, deps, call } = setup();
    await engine.startCall("room-dm", "Long", "dm");
    expect(call().status).toBe("ringing");
    expect(deps.invite).toHaveBeenCalledWith("ws1", "room-dm", "new-call", false);
    await vi.advanceTimersByTimeAsync(VOICE_CALL_RING_TIMEOUT_MS);
    expect(call()).toMatchObject({ status: "ended", reason: "no_answer", peerName: "Long" });
    expect(deps.hangup).toHaveBeenCalledTimes(1);
  });

  it("stops ringing an incoming call after the ring timeout without hanging up", async () => {
    const { engine, deps, call } = setup();
    engine.onInvite(invite());
    expect(call().status).toBe("incoming");
    await vi.advanceTimersByTimeAsync(VOICE_CALL_RING_TIMEOUT_MS);
    expect(call()).toMatchObject({ status: "ended", reason: "missed" });
    expect(deps.hangup).not.toHaveBeenCalled();
    // A missed call is not informational: it waits for the viewer.
    await vi.advanceTimersByTimeAsync(VOICE_CALL_ENDED_DISMISS_MS);
    expect(call().status).toBe("ended");
  });

  it("does not resurrect an invite that already rang out", async () => {
    pendingInvites = [{ ...invite({ call_id: "stale" }), invited_at: new Date(Date.now() - 2 * 60_000).toISOString() } as never];
    const { engine, call } = setup();
    await engine.syncPendingInvites();
    expect(call().status).toBe("idle");
  });

  it("rings for a pending invite that is still fresh", async () => {
    pendingInvites = [{ ...invite({ call_id: "fresh" }), invited_at: new Date(Date.now() - 5_000).toISOString() } as never];
    const { engine, call } = setup();
    await engine.syncPendingInvites();
    expect(call()).toMatchObject({ status: "incoming", callId: "fresh" });
  });

  it("declines a second 1-1 call as busy instead of replacing the current one", async () => {
    const { engine, deps, call } = setup();
    await engine.startCall("room-dm", "Long", "dm");
    const before = call();
    engine.onInvite(invite({ room_id: "room-other", call_id: "second", caller_id: "someone" }));
    expect(call()).toBe(before);
    expect(deps.hangup).toHaveBeenCalledWith("ws1", "room-other", "second");
  });

  it("hangs up and reports when the token cannot be minted after the peer accepts", async () => {
    const { engine, deps, call } = setup({ mintToken: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    await engine.startCall("room-dm", "Long", "dm");
    engine.onAccept({ room_id: "room-dm", call_id: "new-call", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    await vi.advanceTimersByTimeAsync(0);
    expect(call()).toMatchObject({ status: "ended", reason: "connect_failed" });
    expect(deps.hangup).toHaveBeenCalledTimes(1);
  });

  it("connects a 1-1 call when the peer answers", async () => {
    const { engine, call } = setup();
    await engine.startCall("room-dm", "Long", "dm", { withCamera: true });
    engine.onAccept({ room_id: "room-dm", call_id: "new-call", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    await vi.advanceTimersByTimeAsync(0);
    expect(call()).toMatchObject({ status: "active", token: "tok", url: "wss://lk", withCamera: true, outgoing: true });
  });

  it("gives up on a connect phase that never finishes", async () => {
    const { engine, call } = setup({ mintToken: vi.fn(() => new Promise<null>(() => undefined)) });
    void engine.startCall("room-group", "Team", "group");
    await vi.advanceTimersByTimeAsync(0);
    expect(call().status).toBe("connecting");
    await vi.advanceTimersByTimeAsync(VOICE_CALL_CONNECTING_TIMEOUT_MS);
    expect(call()).toMatchObject({ status: "ended", reason: "connect_failed" });
  });

  // Our own frame, as another device of ours sent it: it names the caller as target.
  const own = (roomId: string, callId: string, callKind: string) => ({
    room_id: roomId,
    call_id: callId,
    user_id: "me",
    target_user_id: callKind === "dm" ? "peer" : undefined,
    call_kind: callKind,
  });

  it("stops ringing when this user answers or declines on another device", () => {
    for (const frame of ["onAccept", "onHangup"] as const) {
      const { engine, deps, call } = setup();
      engine.onInvite(invite());
      engine[frame](own("room-dm", "c1", "dm"));
      expect(call().status).toBe("idle");
      expect(deps.hangup).not.toHaveBeenCalled();
    }
  });

  it("stops ringing for a group call this user joined on another device", () => {
    const { engine, call } = setup();
    engine.onInvite(invite({ room_id: "room-other", call_id: "g1", call_kind: "group", target_user_id: undefined }));
    expect(call().status).toBe("incoming");
    engine.onAccept(own("room-other", "g1", "group"));
    expect(call().status).toBe("idle");
  });

  it("keeps ringing when another device of ours answers a different call", () => {
    const { engine, call } = setup();
    engine.onInvite(invite());
    engine.onAccept(own("room-dm", "other-call", "dm"));
    expect(call()).toMatchObject({ status: "incoming", callId: "c1" });
  });
});

describe("call engine on the phone", () => {
  it("answers: accept, then a token, then the room", async () => {
    const { engine, deps, call } = setup();
    engine.onInvite(invite());
    expect(await engine.acceptCall()).toBe(true);
    expect(deps.accept).toHaveBeenCalledWith("ws1", "room-dm", "c1");
    expect(deps.mintToken).toHaveBeenCalledWith("room-dm", "c1");
    expect(call()).toMatchObject({ status: "active", outgoing: false });
  });

  it("shows why a call could not start instead of ringing", async () => {
    const { engine, call } = setup({ invite: vi.fn().mockRejectedValue(new Error("403")) });
    expect(await engine.startCall("room-dm", "Long", "dm")).toBe(false);
    expect(call()).toMatchObject({ status: "ended", reason: "start_failed", peerName: "Long" });
  });

  it("the hang-up button ends a 1-1 call for both and only leaves someone else's group call", async () => {
    const one = setup();
    one.engine.onInvite(invite());
    await one.engine.acceptCall();
    one.engine.markConnected();
    await vi.advanceTimersByTimeAsync(3_000);
    await one.engine.hangUp();
    expect(one.call().status).toBe("idle");
    expect(one.deps.hangup).toHaveBeenCalledWith("ws1", "room-dm", "c1", 3);

    const group = setup();
    group.engine.onInvite(invite({ room_id: "room-other", call_id: "g1", call_kind: "group", target_user_id: undefined }));
    await group.engine.acceptCall();
    await group.engine.hangUp();
    expect(group.call().status).toBe("idle");
    expect(group.deps.hangup).not.toHaveBeenCalled();
  });

  it("a declined incoming 1-1 call tells the caller; a group one just stops ringing", async () => {
    const one = setup();
    one.engine.onInvite(invite());
    await one.engine.hangUp();
    expect(one.deps.hangup).toHaveBeenCalledWith("ws1", "room-dm", "c1", undefined);
    // The declined call never rings again from a late frame.
    one.engine.onInvite(invite());
    expect(one.call().status).toBe("idle");

    const group = setup();
    group.engine.onInvite(invite({ room_id: "room-other", call_id: "g1", call_kind: "group", target_user_id: undefined }));
    await group.engine.hangUp();
    expect(group.deps.hangup).not.toHaveBeenCalled();
  });

  it("a caller who hangs up before the answer leaves a missed call", () => {
    const { engine, call } = setup();
    engine.onInvite(invite());
    engine.onHangup({ room_id: "room-dm", call_id: "c1", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    expect(call()).toMatchObject({ status: "ended", reason: "missed" });
  });

  it("the peer hanging up ends the call with a reason that clears itself", async () => {
    const { engine, call } = setup();
    engine.onInvite(invite());
    await engine.acceptCall();
    engine.onHangup({ room_id: "room-dm", call_id: "c1", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    expect(call()).toMatchObject({ status: "ended", reason: "peer_ended" });
    await vi.advanceTimersByTimeAsync(VOICE_CALL_ENDED_DISMISS_MS);
    expect(call().status).toBe("idle");
  });

  it("a room that drops ends the call, unless this person took it on another device", async () => {
    const dropped = setup();
    dropped.engine.onInvite(invite());
    await dropped.engine.acceptCall();
    dropped.engine.finalizeCallOnDisconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(dropped.call()).toMatchObject({ status: "ended", reason: "peer_ended" });
    expect(dropped.deps.hangup).toHaveBeenCalledTimes(1);

    const moved = setup();
    moved.engine.onInvite(invite());
    await moved.engine.acceptCall();
    moved.engine.finalizeCallOnDisconnect({ movedElsewhere: true });
    expect(moved.call().status).toBe("idle");
    expect(moved.deps.hangup).not.toHaveBeenCalled();
  });

  it("a push tap answers a call that still rings, and opens the room otherwise", async () => {
    pendingInvites = [{ ...invite(), invited_at: new Date(Date.now() - 5_000).toISOString() } as never];
    const ringing = setup();
    expect(await ringing.engine.joinFromPush("room-dm", "c1")).toBe(true);
    expect(ringing.call()).toMatchObject({ status: "active", callId: "c1" });

    pendingInvites = [];
    const gone = setup();
    expect(await gone.engine.joinFromPush("room-dm", "c1")).toBe(false);
    expect(gone.call().status).toBe("idle");

    pendingInvites = [{ ...invite(), invited_at: new Date(Date.now() - 2 * 60_000).toISOString() } as never];
    const rangOut = setup();
    expect(await rangOut.engine.joinFromPush("room-dm", "c1")).toBe(false);

    // The realtime invite got there first: answer that one.
    const live = setup();
    live.engine.onInvite(invite());
    expect(await live.engine.joinFromPush("room-dm", "c1")).toBe(true);
    expect(live.deps.pending).not.toHaveBeenCalled();
  });

  it("signing out closes the call and ignores later frames", async () => {
    const { engine, deps, call } = setup();
    engine.onInvite(invite());
    engine.configure(null);
    expect(call().status).toBe("idle");
    engine.onInvite(invite({ call_id: "c2" }));
    engine.onAccept(invite({ call_id: "c2" }));
    engine.onHangup(invite({ call_id: "c2" }));
    await engine.syncPendingInvites();
    expect(await engine.startCall("room-dm", "Long", "dm")).toBe(false);
    expect(await engine.joinFromPush("room-dm", "c2")).toBe(false);
    expect(call().status).toBe("idle");
    expect(deps.pending).not.toHaveBeenCalled();
    expect(deps.invite).not.toHaveBeenCalled();
  });
});

describe("call engine edges", () => {
  it("ignores frames it cannot place: our own invite, another person's 1-1 call, half a payload, a repeat", () => {
    const { engine, call } = setup();
    engine.onInvite(invite({ caller_id: "me" }));
    engine.onInvite(invite({ target_user_id: "someone-else" }));
    engine.onInvite(invite({ caller_id: undefined }));
    engine.onInvite({});
    engine.onAccept({ call_kind: "dm" });
    engine.onHangup({ room_id: "room-dm" });
    expect(call().status).toBe("idle");
    engine.onInvite(invite());
    const ringing = call();
    engine.onInvite(invite());
    expect(call()).toBe(ringing);
  });

  it("a group call while on another call is let ring out; the caller of a 1-1 call hears busy even when the signal fails", async () => {
    const { engine, deps, call } = setup({ hangup: vi.fn().mockRejectedValue(new Error("offline")) });
    engine.onInvite(invite());
    engine.onInvite(invite({ room_id: "room-other", call_id: "g1", call_kind: "group", target_user_id: undefined }));
    expect(deps.hangup).not.toHaveBeenCalled();
    engine.onInvite(invite({ room_id: "room-other", call_id: "c2", caller_id: "someone" }));
    expect(deps.hangup).toHaveBeenCalledWith("ws1", "room-other", "c2");
    await vi.advanceTimersByTimeAsync(0);
    // A hangup that fails still closes the call here.
    await engine.hangUp();
    expect(call().status).toBe("idle");
  });

  it("does nothing on its buttons with no live call, and the ended panel closes on demand", async () => {
    const { engine, deps, call } = setup({ invite: vi.fn().mockRejectedValue(new Error("403")) });
    await engine.hangUp();
    engine.finalizeCallOnDisconnect();
    expect(await engine.acceptCall()).toBe(false);
    engine.dismissEnded();
    expect(call().status).toBe("idle");
    await engine.startCall("room-dm", "Long", "dm");
    expect(call().status).toBe("ended");
    engine.dismissEnded();
    expect(call().status).toBe("idle");
    expect(deps.hangup).not.toHaveBeenCalled();
  });

  it("starts no second call while one is live, and a pending sync then leaves it alone", async () => {
    pendingInvites = [{ ...invite({ call_id: "other" }), invited_at: new Date().toISOString() } as never];
    const { engine, deps, call } = setup();
    await engine.startCall("room-dm", "Long", "dm");
    expect(await engine.startCall("room-other", "Mai", "dm")).toBe(false);
    await engine.syncPendingInvites();
    expect(call()).toMatchObject({ status: "ringing", callId: "new-call" });
    expect(deps.pending).not.toHaveBeenCalled();
    expect(await engine.joinFromPush("room-dm", "other")).toBe(false);
  });

  it("a pending sync that fails or finds nothing rings nothing", async () => {
    const failing = setup({ pending: vi.fn().mockRejectedValue(new Error("offline")) });
    await failing.engine.syncPendingInvites();
    expect(await failing.engine.joinFromPush("room-dm", "c1")).toBe(false);
    expect(failing.call().status).toBe("idle");
  });

  it("the peer declining an outgoing call says so; a 1-1 call answered says the call is over when hung up", async () => {
    const { engine, call } = setup();
    await engine.startCall("room-dm", "Long", "dm");
    engine.onHangup({ room_id: "room-dm", call_id: "other", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    expect(call().status).toBe("ringing");
    engine.onAccept({ room_id: "room-other", call_id: "new-call", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    expect(call().status).toBe("ringing");
    engine.onHangup({ room_id: "room-dm", call_id: "new-call", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    expect(call()).toMatchObject({ status: "ended", reason: "declined" });
    // Declined is informational: it clears itself.
    await vi.advanceTimersByTimeAsync(VOICE_CALL_ENDED_DISMISS_MS);
    expect(call().status).toBe("idle");
  });

  it("someone else's group call that drops just leaves, without ending it for the others", async () => {
    const { engine, deps, call } = setup();
    engine.onInvite(invite({ room_id: "room-other", call_id: "g1", call_kind: "group", target_user_id: undefined }));
    engine.onAccept(invite({ room_id: "room-other", call_id: "g1", call_kind: "group", user_id: "peer", target_user_id: undefined }));
    await engine.acceptCall();
    engine.finalizeCallOnDisconnect();
    expect(call()).toMatchObject({ status: "ended", reason: "peer_ended" });
    expect(deps.hangup).not.toHaveBeenCalled();
  });

  it("an answer that fails, or a caller who hangs up meanwhile, ends the answer", async () => {
    const refused = setup({ accept: vi.fn().mockRejectedValue(new Error("403")) });
    refused.engine.onInvite(invite());
    expect(await refused.engine.acceptCall()).toBe(false);
    expect(refused.call()).toMatchObject({ status: "ended", reason: "connect_failed" });

    let release: () => void = () => undefined;
    const slow = setup({ accept: vi.fn(() => new Promise<boolean>((resolve) => (release = () => resolve(true)))) });
    slow.engine.onInvite(invite());
    const answer = slow.engine.acceptCall();
    slow.engine.onHangup({ room_id: "room-dm", call_id: "c1", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    release();
    expect(await answer).toBe(false);
    expect(slow.deps.mintToken).not.toHaveBeenCalled();

    let refuse: (err: Error) => void = () => undefined;
    const late = setup({ accept: vi.fn(() => new Promise<boolean>((_, reject) => (refuse = reject))) });
    late.engine.onInvite(invite());
    const lateAnswer = late.engine.acceptCall();
    late.engine.onHangup({ room_id: "room-dm", call_id: "c1", user_id: "peer", target_user_id: "me", call_kind: "dm" });
    refuse(new Error("gone"));
    expect(await lateAnswer).toBe(false);
    expect(late.call()).toMatchObject({ status: "ended", reason: "peer_ended" });
  });

  it("a token that comes back empty, or after the call ended, connects nothing", async () => {
    const empty = setup({ mintToken: vi.fn().mockResolvedValue(null) });
    await empty.engine.startCall("room-other", "Team", "group");
    expect(empty.call()).toMatchObject({ status: "ended", reason: "connect_failed" });
    expect(empty.deps.hangup).toHaveBeenCalledTimes(1);

    let give: (v: { token: string; url: string }) => void = () => undefined;
    const late = setup({ mintToken: vi.fn(() => new Promise<{ token: string; url: string }>((resolve) => (give = resolve))) });
    const start = late.engine.startCall("room-other", "Team", "group");
    await vi.advanceTimersByTimeAsync(0);
    await late.engine.hangUp();
    give({ token: "t", url: "u" });
    expect(await start).toBe(false);
    expect(late.call().status).toBe("idle");
  });
});
