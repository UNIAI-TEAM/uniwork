// Copied from packages/views/chat/use-native-voice-call.ts: the web's call
// state machine (ring, answer, decline, busy, the ring/connect/ended clocks,
// frames from this user's other devices, pending-invite recovery), as a store
// instead of a hook so the call outlives any one screen and call-engine.test.ts
// drives it in node. Mobile adds startCall's own failure panel (the web host
// reports it), the hang-up button's choice and joinFromPush (a tap on a
// "X đang gọi" push).
import type { PendingChatVoiceInvite } from "@uniwork/core/api/endpoints/chat-schemas";
import { createStore } from "zustand/vanilla";
import type { OutgoingVoiceCall } from "@/data/chat-api-schemas";
import { bestEffort, breadcrumb, reportError } from "@/data/report";
import { VOICE_CALL_HANDLED_CODES } from "@/lib/voice-call";
import { incomingStateFromInvite, latestRingingInvite, voiceEventForUser, type VoiceInvitePayload } from "@uniwork/core/chat/voice-call-invites";
import { isMultiPartyVoiceCall } from "@uniwork/core/chat/voice-call-kind";
import {
  VOICE_CALL_CONNECTING_TIMEOUT_MS,
  VOICE_CALL_ENDED_DISMISS_MS,
  VOICE_CALL_RING_TIMEOUT_MS,
  isInformationalEnd,
  type VoiceCallEndInit,
  type VoiceCallKind,
  type VoiceCallOverlayState,
} from "@uniwork/core/chat/voice-call-types";

export interface CallEngineDeps {
  invite(wsId: string, roomId: string, callId: string, video: boolean): Promise<boolean>;
  accept(wsId: string, roomId: string, callId: string): Promise<boolean>;
  hangup(wsId: string, roomId: string, callId: string, durationSeconds?: number): Promise<boolean>;
  pending(wsId: string): Promise<PendingChatVoiceInvite[]>;
  /** The calls this person started that the server still holds, and whether each was answered. */
  outgoing(wsId: string): Promise<OutgoingVoiceCall[]>;
  mintToken(roomId: string, callId: string): Promise<{ token: string; url: string } | null>;
  createCallId(): string;
}

/** Who is calling from where; each open workspace layout attaches one, the top one is used. */
export interface CallContext {
  wsId: string;
  userId: string;
  /** The rooms this person is in: a group call rings only for those. */
  allowedRoomIds: () => ReadonlySet<string>;
}

type LiveCallState = Exclude<VoiceCallOverlayState, { status: "idle" } | { status: "ended" }>;

function isLive(state: VoiceCallOverlayState): state is LiveCallState {
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

function endedFrom(state: LiveCallState, init: VoiceCallEndInit): VoiceCallOverlayState {
  const outgoing = state.status !== "incoming" && state.outgoing;
  const withCamera = state.status === "incoming" ? undefined : state.withCamera;
  const { callId, roomId, peerName, callKind } = state;
  return { status: "ended", reason: init.reason, error: init.error, callId, roomId, peerName, callKind, outgoing, withCamera };
}

function pendingToPayload({ room_id, call_id, caller_id, caller_name, call_kind, room_name }: PendingChatVoiceInvite): VoiceInvitePayload {
  return { room_id, call_id, caller_id, caller_name, call_kind, room_name };
}

/**
 * A call that could not start, connect or go on leaves a breadcrumb, and its
 * error (a refused invite, accept or token) reaches crash reporting unless it
 * is expected or a refusal the panel already explains (VOICE_CALL_HANDLED_CODES).
 * Mobile only: the web host reports through its own panel.
 */
function noteFailure(reason: string, error: unknown): void {
  breadcrumb("calls", `call ${reason}`, "warning");
  if (error !== undefined) reportError(error, { source: "calls", tags: { reason }, handledCodes: VOICE_CALL_HANDLED_CODES });
}

export function createCallEngine(deps: CallEngineDeps) {
  const store = createStore<{ call: VoiceCallOverlayState }>(() => ({ call: { status: "idle" } }));
  // The open workspaces, innermost last (a push can stack a second workspace
  // screen over the first); a live call implies one (the last detach ends it).
  const contexts: CallContext[] = [];
  let ctx: CallContext | null = null;
  let hangupSent: string | null = null;
  let connectedAt: number | null = null;
  // Told once per call when its media room first connects (data/analytics.ts › call_connect).
  const mediaListeners = new Set<(callId: string) => void>();
  // Calls that already rang out, were declined or ended here: a late frame or
  // the pending-invite sync must not ring them again.
  const closed = new Set<string>();
  let clock: ReturnType<typeof setTimeout> | undefined;

  const current = () => store.getState().call;
  /** The live call with this id, if it is still the one on screen. */
  const liveWith = <S extends LiveCallState["status"]>(callId: string, status?: S) => {
    const state = current();
    return (isLive(state) && state.callId === callId && (!status || state.status === status) ? state : null) as Extract<
      LiveCallState,
      { status: S }
    > | null;
  };

  function setCall(next: VoiceCallOverlayState) {
    store.setState({ call: next });
    armClock(next);
  }

  // Ring, connect and "ended" panels all run on a clock, not forever. A new
  // state always clears the old clock, so a clock that fires is for this one.
  function armClock(state: VoiceCallOverlayState) {
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
    await deps.hangup(ctx!.wsId, state.roomId, state.callId, durationSeconds).catch(bestEffort("calls", "hangup not sent", "report"));
  }

  /** Ends the current call the way its kind requires, with a reason on screen. */
  async function failCall(state: LiveCallState, init: VoiceCallEndInit) {
    noteFailure(init.reason, init.error);
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
    if (!isMultiPartyVoiceCall(incoming.callKind))
      void deps.hangup(ctx.wsId, incoming.roomId, incoming.callId).catch(bestEffort("calls", "busy not signalled", "report"));
  }

  /**
   * A caller still ringing whose socket missed chat.voice.accept (a
   * reconnect, the phone back from the background) would ring out and hang
   * up on a callee who answered: the server's list of this person's live
   * calls says whether it was answered. Only that is acted on; a call it
   * does not list proves nothing (the server holds calls per node), and the
   * ring clock still ends one nobody answered.
   */
  async function connectIfAnswered(wsId: string, callId: string) {
    const calls = await deps.outgoing(wsId).catch(bestEffort("calls", "outgoing calls not read", "report"));
    const ringing = liveWith(callId, "ringing");
    if (ringing && calls?.some((c) => c.call_id === ringing.callId && c.room_id === ringing.roomId && c.accepted)) {
      await connectCall(ringing.roomId, ringing.callId, ringing.peerName, true, "dm", undefined, ringing.withCamera);
    }
  }

  async function syncPendingInvites() {
    if (!ctx || isLive(current())) return;
    const latest = latestRingingInvite((await deps.pending(ctx.wsId).catch(bestEffort("calls", "pending calls not read", "report"))) ?? []);
    if (latest) applyIncomingInvite(pendingToPayload(latest), { skipRoomCheck: true });
  }

  async function ringFromPush(roomId: string, callId: string) {
    if (!ctx) return false;
    if (!isLive(current())) {
      const invites = (await deps.pending(ctx.wsId).catch(bestEffort("calls", "pending calls not read", "report"))) ?? [];
      const invite = latestRingingInvite(invites.filter((i) => i.room_id === roomId && i.call_id === callId));
      if (invite) applyIncomingInvite(pendingToPayload(invite), { skipRoomCheck: true });
    }
    return liveWith(callId) !== null;
  }

  async function connectCall(
    roomId: string,
    callId: string,
    peerName: string,
    outgoing: boolean,
    callKind: VoiceCallKind,
    callerName?: string,
    withCamera = false,
  ) {
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

  /**
   * Answers the ringing call. With `expectedCallId` (the call the person tapped
   * Answer on before an await, such as the microphone primer) it answers only
   * that call: one that rang in meanwhile is never answered unasked.
   */
  async function acceptCall(expectedCallId?: string) {
    const state = current();
    if (state.status !== "incoming") return false;
    if (expectedCallId !== undefined && state.callId !== expectedCallId) return false;
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
    /** A workspace opened; the function it returns closes it again. With none left (sign-out), the call ends here. */
    attach(next: CallContext) {
      contexts.push(next);
      ctx = next;
      return () => {
        contexts.splice(contexts.indexOf(next), 1);
        ctx = contexts.at(-1) ?? null;
        if (!ctx) setCall({ status: "idle" });
      };
    },
    syncPendingInvites,
    /**
     * Back in front, or a socket that reconnected (audit C1): frames sent
     * while this phone was not listening are gone. A call still ringing here
     * that the server no longer lists (the caller hung up, another device of
     * ours answered) stops ringing; with no call live, one that rings now is
     * picked up when `ring` (the calls switch) is on. A call this person is
     * ringing connects when the server says it was answered meanwhile. A
     * connecting or live call keeps its clocks and the media connection,
     * which know its state better than the invite list does.
     */
    async reconcile(options: { ring: boolean }) {
      const state = current();
      if (!ctx) return;
      if (state.status === "ringing") {
        await connectIfAnswered(ctx.wsId, state.callId);
        return;
      }
      if (state.status !== "incoming") {
        if (options.ring) await syncPendingInvites();
        return;
      }
      const invites = await deps.pending(ctx.wsId).catch(bestEffort("calls", "pending calls not read", "report"));
      // No answer is no evidence: the ring clock still ends it.
      if (!invites) return;
      const ringing = liveWith(state.callId, "incoming");
      if (ringing && !invites.some((i) => i.call_id === ringing.callId && i.room_id === ringing.roomId)) closeLocal(ringing, { reason: "missed" });
    },
    /** A chat.voice.* frame, already decoded (data/realtime/frames.ts): the ids it names are non-empty strings. */
    onInvite(data: VoiceInvitePayload) {
      applyIncomingInvite(data);
    },
    onAccept(data: VoiceInvitePayload) {
      // A group call has no ringing caller to connect; there only our own answer elsewhere counts.
      if (!relevant(data) || isMultiPartyVoiceCall(data.call_kind)) return;
      const ringing = liveWith(data.call_id, "ringing");
      // connectCall owns its failures (hang up + reason on the panel).
      if (ringing?.roomId === data.room_id)
        void connectCall(ringing.roomId, ringing.callId, ringing.peerName, true, "dm", undefined, ringing.withCamera);
    },
    onHangup(data: VoiceInvitePayload) {
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
        // The web host shows this on its panel (reportStartFailure, which leaves a call that rang in meanwhile alone).
        noteFailure("start_failed", error);
        if (!isLive(current())) setCall({ status: "ended", reason: "start_failed", error, roomId, peerName, callKind, outgoing: true, withCamera });
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
    /** The media room connected (call-room.tsx): the call's clock starts, once per live call. */
    markConnected() {
      const state = current();
      if (!isLive(state) || connectedAt !== null) return;
      connectedAt = Date.now();
      for (const listener of mediaListeners) listener(state.callId);
    },
    /** Called with the call id the first time each call's media room connects. */
    onMediaConnected(listener: (callId: string) => void): () => void {
      mediaListeners.add(listener);
      return () => void mediaListeners.delete(listener);
    },
    dismissEnded() {
      if (current().status === "ended") setCall({ status: "idle" });
    },
    /**
     * The Answer button of the phone's own ringing notification: answer if
     * the call still rings for this person (true too when it is already
     * being answered here), else false and the caller opens the room (where
     * the missed-call log lands).
     */
    async joinFromPush(roomId: string, callId: string) {
      if (!(await ringFromPush(roomId, callId))) return false;
      return liveWith(callId, "incoming") ? acceptCall(callId) : true;
    },
    /**
     * A tap on a ringing push or notification (or its full-screen intent on
     * a locked phone): the call's ringing screen, Answer and Decline, if it
     * still rings for this person (audit P2 Calls: a tap answered at once).
     * False when it does not, and the caller opens the room.
     */
    ringFromPush,
    /** The workspace the engine rings and calls in now, null with none open. */
    contextWorkspaceId: () => ctx?.wsId ?? null,
  };
}
