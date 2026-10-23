// Reading a chat call's invite: who a voice frame is for, the ringing state
// an invite opens, and which pending invite may still ring. Pure: the web's
// call overlay (packages/views/chat) and the phone's call engine
// (apps/chat-mobile/data/calls/call-engine.ts, ADR 0011) share it.
import type { PendingChatVoiceInvite } from "../api/endpoints/chat-schemas";
import { isMultiPartyVoiceCall, voiceCallKindFromServer } from "./voice-call-kind";
import { VOICE_CALL_RING_TIMEOUT_MS, type VoiceCallOverlayState } from "./voice-call-types";

/** A chat.voice.* frame's payload, or a pending invite read as one; the frames carry ids only. */
export type VoiceInvitePayload = {
  room_id?: string;
  call_id?: string;
  caller_id?: string;
  caller_name?: string;
  target_user_id?: string;
  call_kind?: string;
  room_name?: string;
  /** Who accepted or hung up (chat.voice.accept / hangup). */
  user_id?: string;
};

type IncomingState = Extract<VoiceCallOverlayState, { status: "incoming" }>;

export function voiceEventForUser(
  data: VoiceInvitePayload,
  currentUserId: string,
  allowedRoomIds: ReadonlySet<string>,
): boolean {
  if (!data.room_id) return false;
  if (data.target_user_id) {
    return data.target_user_id === currentUserId;
  }
  return allowedRoomIds.has(data.room_id);
}

export function incomingStateFromInvite(data: VoiceInvitePayload): IncomingState | null {
  if (!data.room_id || !data.call_id || !data.caller_id) return null;
  const callKind = voiceCallKindFromServer(data.call_kind);
  const peerName = isMultiPartyVoiceCall(callKind)
    ? data.room_name?.trim() || data.caller_name?.trim() || data.caller_id
    : data.caller_name?.trim() || data.caller_id;
  const callerName = data.caller_name?.trim() || data.caller_id;
  return {
    status: "incoming",
    callId: data.call_id,
    roomId: data.room_id,
    peerName,
    callKind,
    callerName: isMultiPartyVoiceCall(callKind) ? callerName : undefined,
    callerId: isMultiPartyVoiceCall(callKind) ? data.caller_id : undefined,
  };
}

/**
 * The newest pending invite that could still be ringing. The server keeps
 * invites for minutes; a call that rang out on the caller's side must not
 * come back as "incoming" when this client reconnects.
 */
export function latestRingingInvite(
  invites: readonly PendingChatVoiceInvite[],
  now: number = Date.now(),
): PendingChatVoiceInvite | null {
  let latest: PendingChatVoiceInvite | null = null;
  let latestAt = -Infinity;
  for (const invite of invites) {
    const at = Date.parse(invite.invited_at);
    if (!Number.isFinite(at) || now - at >= VOICE_CALL_RING_TIMEOUT_MS) continue;
    if (at > latestAt) {
      latest = invite;
      latestAt = at;
    }
  }
  return latest;
}
