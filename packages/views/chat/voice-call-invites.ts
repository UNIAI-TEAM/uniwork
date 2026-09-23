import type { PendingChatVoiceInvite } from "@uniwork/core/api/endpoints/chat";
import { isMultiPartyVoiceCall, voiceCallKindFromServer } from "./voice-call-kind-utils";
import {
  VOICE_CALL_RING_TIMEOUT_MS,
  type VoiceCallOverlayState,
} from "./voice-call-overlay-types";

export type VoiceInvitePayload = {
  room_id?: string;
  call_id?: string;
  caller_id?: string;
  caller_name?: string;
  target_user_id?: string;
  call_kind?: string;
  room_name?: string;
};

type IncomingState = Extract<VoiceCallOverlayState, { status: "incoming" }>;

export function voiceEventForUser(
  data: VoiceInvitePayload,
  currentUserId: string,
  allowedRoomIds: ReadonlySet<string>,
): boolean {
  if (!data.room_id) return false;
  if (isMultiPartyVoiceCall(data.call_kind)) {
    return allowedRoomIds.has(data.room_id);
  }
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
  };
}

/**
 * The newest pending invite that could still be ringing. The server keeps
 * invites for minutes; a call that rang out on the caller's side must not
 * come back as "incoming" when this tab reconnects.
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
