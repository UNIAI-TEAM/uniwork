// Copied from packages/views/chat/use-native-voice-call.ts: the web's call
// state machine (ring, answer, decline, busy, the ring/connect/ended clocks,
// frames from this user's other devices, pending-invite recovery), as a store
// instead of a hook so the call outlives any one screen and call-engine.test.ts
// drives it in node. Mobile adds startCall's own failure panel (the web host
// reports it), the hang-up button's choice and joinFromPush (a tap on a
// "X đang gọi" push).
import type { PendingChatVoiceInvite } from "@uniwork/core/api/endpoints/chat-schemas";
import { createStore } from "zustand/vanilla";
import {
  VOICE_CALL_CONNECTING_TIMEOUT_MS,
  VOICE_CALL_ENDED_DISMISS_MS,
  VOICE_CALL_RING_TIMEOUT_MS,
  incomingStateFromInvite,
  isInformationalEnd,
  isMultiPartyVoiceCall,
  latestRingingInvite,
  voiceEventForUser,
  type VoiceCallEndInit,
  type VoiceCallKind,
  type VoiceCallState,
  type VoiceInvitePayload,
} from "@/lib/voice-call";

export interface CallEngineDeps {
  invite(wsId: string, roomId: string, callId: string, video: boolean): Promise<boolean>;
  accept(wsId: string, roomId: string, callId: string): Promise<boolean>;
  hangup(wsId: string, roomId: string, callId: string, durationSeconds?: number): Promise<boolean>;
  pending(wsId: string): Promise<PendingChatVoiceInvite[]>;
  mintToken(roomId: string, callId: string): Promise<{ token: string; url: string } | null>;
  createCallId(): string;
}

/** Who is calling from where; the workspace layout sets it, sign-out clears it. */
export interface CallContext {
  wsId: string;
  userId: string;
  /** The rooms this person is in: a group call rings only for those. */
  allowedRoomIds: () => ReadonlySet<string>;
}

type LiveCallState = Exclude<VoiceCallState, { status: "idle" } | { status: "ended" }>;

function isLive(state: VoiceCallState): state is LiveCallState {
  return state.status !== "idle" && state.status !== "ended";
}

/**
 * Whether leaving this call must tell the server (and so the others): a 1-1
 * call ends for both, a ringing call stops ringing, and the person who
 * started a group call closes it. Anyone else in a group call just leaves.
 */
function leavingSignalsHangup(state: LiveCallState): boolean {
  if (state.callKind === "dm" || state.status === "ringing") return true;
  return state.status !== "incoming" && state.outgoing && isMultiPartyVoiceCall(state.callKind);
}

function endedFrom(state: LiveCallState, init: VoiceCallEndInit): VoiceCallState {
  const outgoing = state.status !== "incoming" && state.outgoing;
  const withCamera = state.status === "incoming" ? undefined : state.withCamera;
  const { callId, roomId, peerName, callKind } = state;
  return { status: "ended", reason: init.reason, error: init.error, callId, roomId, peerName, callKind, outgoing, withCamera };
}

function pendingToPayload({ room_id, call_id, caller_id, caller_name, call_kind, room_name }: PendingChatVoiceInvite): VoiceInvitePayload {
  return { room_id, call_id, caller_id, caller_name, call_kind, room_name };
}

export function createCallEngine(deps: CallEngineDeps) {
  const store = createStore<{ call: VoiceCallState }>(() => ({ call: { status: "idle" } }));
  // Set while a workspace is open; a live call implies it (configure(null) ends the call).
  let ctx: CallContext | null = null;
  let hangupSent: string | null = null;
  let connectedAt: number | null = null;
  // Calls that already rang out, were declined or ended here: a late frame or
  // the pending-invite sync must not ring them again.
  const closed = new Set<string>();
  let clock: ReturnType<typeof setTimeout> | undefined;

  const current = () => store.getState().call;
  /** The live call with this id, if it is still the one on screen. */
  const liveWith = <S extends LiveCallState["status"]>(callId: string, status?: S) => {
    const state = current();
    return (isLive(state) && state.callId === callId && (!status || state.status === status) ? state : null) as Extract<LiveCallState, { status: S }> | null;
  };

  function setCall(next: VoiceCallState) {
    store.setState({ call: next });
    armClock(next);
  }

  // Ring, connect and "ended" panels all run on a clock, not forever. A new
  // state always clears the old clock, so a clock that fires is for this one.
  function armClock(state: VoiceCallState) {
    clearTimeout(clock);
    const after = (delay: number, run: () => void) => (clock = setTimeout(run, delay));
    switch (state.status) {
      case "ringing":
        after(VOICE_CALL_RING_TIMEOUT_MS, () => void endCallForAll(state, { reason: "no_answer" }));
        break;
      case "incoming":
        after(VOICE_CALL_RING_TIMEOUT_MS, () => closeLocal(state, { reason: "missed" }));
        break;
      case "connecting":
        after(VOICE_CALL_CONNECTING_TIMEOUT_MS, () => void failCall(state, { reason: "connect_failed" }));
        break;
      case "ended":
        if (isInformationalEnd(state.reason)) after(VOICE_CALL_ENDED_DISMISS_MS, () => setCall({ status: "idle" }));
        break;
    }
  }

  /** Closes the local call: to idle, or to an ended panel that says why. */
  function closeLocal(state: LiveCallState, init?: VoiceCallEndInit) {
    connectedAt = null;
    closed.add(state.callId);
    setCall(init ? endedFrom(state, init) : { status: "idle" });
  }

  async function endCallForAll(state: LiveCallState, init?: VoiceCallEndInit) {
    const durationSeconds = connectedAt != null ? Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)) : undefined;
    // The call closes on screen at once; the hangup signal is best effort.
    closeLocal(state, init);
    hangupSent = state.callId;
    await deps.hangup(ctx!.wsId, state.roomId, state.callId, durationSeconds).catch(() => undefined);
  }

  /** Ends the current call the way its kind requires, with a reason on screen. */
  async function failCall(state: LiveCallState, init: VoiceCallEndInit) {
    if (leavingSignalsHangup(state)) await endCallForAll(state, init);
    else closeLocal(state, init);
  }

  function applyIncomingInvite(data: VoiceInvitePayload, options?: { skipRoomCheck?: boolean }) {
    if (!ctx || data.caller_id === ctx.userId || closed.has(data.call_id ?? "")) return;
    if (!options?.skipRoomCheck && !voiceEventForUser(data, ctx.userId, ctx.allowedRoomIds())) return;
    const incoming = incomingStateFromInvite(data);
    if (!incoming) return;
    const state = current();
    if (!isLive(state)) {
      hangupSent = null;
      setCall(incoming);
      return;
    }
    if (state.callId === incoming.callId) return;
    // Already on (or answering, or ringing for) another call: say "busy" right
    // away instead of letting the second caller ring out. A group call keeps
    // going without us; only a 1-1 caller would be left ringing.
    closed.add(incoming.callId);
    if (!isMultiPartyVoiceCall(incoming.callKind)) void deps.hangup(ctx.wsId, incoming.roomId, incoming.callId).catch(() => undefined);
  }

  async function syncPendingInvites() {
    if (!ctx || isLive(current())) return;
    const latest = latestRingingInvite(await deps.pending(ctx.wsId).catch(() => []));
    if (latest) applyIncomingInvite(pendingToPayload(latest), { skipRoomCheck: true });
  }

  async function connectCall(roomId: string, callId: string, peerName: string, outgoing: boolean, callKind: VoiceCallKind, callerName?: string, withCamera = false) {
    setCall({ status: "connecting", callId, roomId, peerName, outgoing, callKind, callerName, withCamera });
    let creds: { token: string; url: string } | null = null;
    let error: unknown;
    try {
      creds = await deps.mintToken(roomId, callId);
    } catch (err) {
      error = err;
    }
    // The call may have ended (a hangup, the clock) while the token was on its way.
    const connecting = liveWith(callId, "connecting");
    if (!connecting) return false;
    if (!creds) {
      await failCall(connecting, { reason: "connect_failed", error });
      return false;
    }
    setCall({ status: "active", callId, roomId, peerName, token: creds.token, url: creds.url, outgoing, callKind, callerName, withCamera });
    return true;
  }

  async function acceptCall() {
    const state = current();
    if (state.status !== "incoming") return false;
    const { callId, roomId, peerName, callKind, callerName } = state;
    setCall({ status: "connecting", callId, roomId, peerName, outgoing: false, callKind, callerName });
    try {
      await deps.accept(ctx!.wsId, roomId, callId);
    } catch (error) {
      const connecting = liveWith(callId, "connecting");
      if (connecting) await failCall(connecting, { reason: "connect_failed", error });
      return false;
    }
    // The caller may have hung up while the accept was in flight.
    if (!liveWith(callId, "connecting")) return false;
    return connectCall(roomId, callId, peerName, false, callKind, callerName);
  }

  /** An accept or hangup frame about a call this person could be in, from someone else. */
  function relevant(data: VoiceInvitePayload): data is VoiceInvitePayload & { room_id: string; call_id: string } {
    if (!ctx || !data.room_id || !data.call_id) return false;
    if (data.user_id === ctx.userId) {
      // Our own frame: another device of ours answered or declined. Stop ringing here.
      const ringing = liveWith(data.call_id, "incoming");
      if (ringing) closeLocal(ringing);
      return false;
    }
    return voiceEventForUser(data, ctx.userId, ctx.allowedRoomIds());
  }

  return {
    store,
    configure(next: CallContext | null) {
      ctx = next;
      if (!next) setCall({ status: "idle" });
    },
    syncPendingInvites,
    onInvite(payload: unknown) {
      applyIncomingInvite(payload as VoiceInvitePayload);
    },
    onAccept(payload: unknown) {
      const data = payload as VoiceInvitePayload;
      // A group call has no ringing caller to connect; there only our own answer elsewhere counts.
      if (!relevant(data) || isMultiPartyVoiceCall(data.call_kind)) return;
      const ringing = liveWith(data.call_id, "ringing");
      // connectCall owns its failures (hang up + reason on the panel).
      if (ringing?.roomId === data.room_id) void connectCall(ringing.roomId, ringing.callId, ringing.peerName, true, "dm", undefined, ringing.withCamera);
    },
    onHangup(payload: unknown) {
      const data = payload as VoiceInvitePayload;
      if (!relevant(data)) return;
      closed.add(data.call_id);
      const state = liveWith(data.call_id);
      if (state?.roomId !== data.room_id) return;
      hangupSent = state.callId;
      closeLocal(state, { reason: state.status === "incoming" ? "missed" : state.status === "ringing" ? "declined" : "peer_ended" });
    },
    async startCall(roomId: string, peerName: string, callKind: VoiceCallKind, options?: { withCamera?: boolean }) {
      if (!ctx || isLive(current())) return false;
      const withCamera = options?.withCamera ?? false;
      const callId = deps.createCallId();
      hangupSent = null;
      try {
        await deps.invite(ctx.wsId, roomId, callId, withCamera);
      } catch (error) {
        // The web host shows this on its panel (reportStartFailure); here the engine does.
        setCall({ status: "ended", reason: "start_failed", error, roomId, peerName, callKind, outgoing: true, withCamera });
        return false;
      }
      if (isMultiPartyVoiceCall(callKind)) return connectCall(roomId, callId, peerName, true, callKind, undefined, withCamera);
      setCall({ status: "ringing", callId, roomId, peerName, outgoing: true, callKind: "dm", withCamera });
      return true;
    },
    acceptCall,
    /**
     * The red button, ringing or in the call: a 1-1 call ends for both (an
     * incoming one is declined), a group call ends for all when this person
     * started it, and anyone else just leaves (or stops ringing).
     */
    async hangUp() {
      const state = current();
      if (!isLive(state)) return;
      if (leavingSignalsHangup(state)) await endCallForAll(state);
      else closeLocal(state);
    },
    /**
     * The media room let go of us: the peer ended it or the link dropped. When
     * this person took the call on another device, it goes on there untouched.
     */
    finalizeCallOnDisconnect(info?: { movedElsewhere?: boolean }) {
      const state = current();
      if (!isLive(state)) return;
      if (hangupSent === state.callId || info?.movedElsewhere) closeLocal(state);
      else void failCall(state, { reason: "peer_ended" });
    },
    markConnected() {
      connectedAt ??= Date.now();
    },
    dismissEnded() {
      if (current().status === "ended") setCall({ status: "idle" });
    },
    /**
     * A tap on a "X đang gọi" push: answer if the call still rings for this
     * person, else false and the caller opens the room (where the missed-call
     * log lands).
     */
    async joinFromPush(roomId: string, callId: string) {
      if (!ctx) return false;
      if (!liveWith(callId, "incoming") && !isLive(current())) {
        const invites = await deps.pending(ctx.wsId).catch(() => []);
        const invite = latestRingingInvite(invites.filter((i) => i.room_id === roomId && i.call_id === callId));
        if (invite) applyIncomingInvite(pendingToPayload(invite), { skipRoomCheck: true });
      }
      return liveWith(callId, "incoming") ? acceptCall() : false;
    },
  };
}
