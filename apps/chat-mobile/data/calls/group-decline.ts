// The call screen's Decline of a group or channel call also tells the server (POST …/voice/decline), so the call
// stops ringing on the person's other devices and the pending list stops offering it (review answer-path gaps).
// The engine (call-engine.ts, a copy of the web's) only closes such a call here, so this follows its transitions
// instead: an incoming group call that goes straight to idle was declined — a ring that runs out ends as "missed",
// a caller who gives up as an ended panel. An answer on another of the person's devices also closes it to idle;
// the server then has nothing to decline and says ok. A Decline tapped on the ringing notification while the app
// runs goes through the engine (call-actions.ts › hangUp) and so through here too.
import { isMultiPartyVoiceCall } from "@uniwork/core/chat/voice-call-kind";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import type { StoreApi } from "zustand/vanilla";
import { bestEffort } from "../report";

export interface GroupDeclineEnv {
  decline(wsId: string, roomId: string, callId: string): Promise<unknown>;
  /** The workspace the engine rings for, or null without one. */
  workspaceId(): string | null;
}

/** Tells the server of each group call declined on screen; the function it returns stops it. */
export function installGroupDecline(store: StoreApi<{ call: VoiceCallOverlayState }>, env: GroupDeclineEnv): () => void {
  return store.subscribe(({ call: next }, { call: previous }) => {
    if (previous.status !== "incoming" || next.status !== "idle" || !isMultiPartyVoiceCall(previous.callKind)) return;
    const wsId = env.workspaceId();
    if (!wsId) return;
    void env.decline(wsId, previous.roomId, previous.callId).catch(bestEffort("calls", "group decline not sent", "breadcrumb"));
  });
}
