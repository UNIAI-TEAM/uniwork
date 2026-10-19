// Copied from packages/views/chat/{voice-call-overlay-types.ts,
// voice-call-kind-utils.ts, voice-call-invites.ts}: the call states, clocks and
// invite reading of the web's chat calls; keep in parity (voice-call.test.ts
// runs the web's cases).
import type { PendingChatVoiceInvite } from "@uniwork/core/api/endpoints/chat-schemas";

export type VoiceCallKind = "dm" | "group" | "channel";

/**
 * Why a call closed without the viewer pressing hang-up. The panel stays up
 * with this reason instead of vanishing, so nobody is left guessing.
 */
export type VoiceCallEndReason =
  | "no_answer"
  | "missed"
  | "declined"
  | "connect_failed"
  | "start_failed"
  | "device"
  | "peer_ended"
  | "peer_left"
  | "peer_unreachable"
  | "alone"
  | "everyone_left";

export type VoiceCallEndInit = { reason: VoiceCallEndReason; error?: unknown };

export type VoiceCallEndedState = {
  status: "ended";
  reason: VoiceCallEndReason;
  callId?: string;
  roomId: string;
  peerName: string;
  callKind: VoiceCallKind;
  outgoing: boolean;
  withCamera?: boolean;
  error?: unknown;
};

export type VoiceCallState =
  | { status: "idle" }
  | { status: "incoming"; callId: string; roomId: string; peerName: string; callKind: VoiceCallKind; callerName?: string }
  | { status: "ringing"; callId: string; roomId: string; peerName: string; outgoing: true; callKind: VoiceCallKind; withCamera?: boolean }
  | {
      status: "connecting";
      callId: string;
      roomId: string;
      peerName: string;
      outgoing: boolean;
      callKind: VoiceCallKind;
      callerName?: string;
      withCamera?: boolean;
    }
  | {
      status: "active";
      callId: string;
      roomId: string;
      peerName: string;
      token: string;
      url: string;
      outgoing: boolean;
      callKind: VoiceCallKind;
      callerName?: string;
      withCamera?: boolean;
    }
  | VoiceCallEndedState;

/** How long a call rings, on both ends, before it counts as unanswered. */
export const VOICE_CALL_RING_TIMEOUT_MS = 45_000;

/** Accept + token mint, before the room component takes over with its own timeout. */
export const VOICE_CALL_CONNECTING_TIMEOUT_MS = 20_000;

/** An informational end ("call ended") clears itself; a failure waits for the viewer. */
export const VOICE_CALL_ENDED_DISMISS_MS = 6_000;

export function isInformationalEnd(reason: VoiceCallEndReason): boolean {
  return reason === "peer_ended" || reason === "peer_left" || reason === "alone" || reason === "everyone_left" || reason === "declined";
}

type Translate = (key: string, params?: Record<string, string>) => string;

/** The server's refusal, in chat's own words (voice-call-copy.ts › voiceCallErrorMessage, never its raw message). */
function voiceCallErrorMessage(err: unknown, t: Translate, fallback: string): string {
  const code = (err as { body?: { error?: { code?: unknown } } } | undefined)?.body?.error?.code;
  if (code === "livekit_not_configured") return t("chat.voice_call_not_configured");
  if (code === "chat_user_blocked") return t("chat.voice_call_blocked");
  return fallback;
}

/**
 * The one line the ended panel says about why the call is over
 * (voice-call-copy.ts › voiceCallEndedMessage), for the reasons a phone call
 * can end with; the web's device and room-presence reasons read as "ended".
 */
export function voiceCallEndedMessage(ended: VoiceCallEndedState, t: Translate): string {
  switch (ended.reason) {
    case "no_answer":
      return t("chat.voice_call_ended_no_answer");
    case "missed":
      return t("chat.voice_call_ended_missed");
    case "declined":
      return t("chat.voice_call_log_declined_outgoing");
    case "connect_failed":
      return voiceCallErrorMessage(ended.error, t, t("chat.voice_call_connect_failed"));
    case "start_failed":
      return voiceCallErrorMessage(ended.error, t, t("chat.voice_call_failed"));
    default:
      return t("chat.voice_call_ended_peer_ended");
  }
}

export function isMultiPartyVoiceCall(kind: VoiceCallKind | string | undefined): boolean {
  return kind === "group" || kind === "channel";
}

export function voiceCallKindFromServer(callKind?: string): VoiceCallKind {
  if (callKind === "channel") return "channel";
  if (callKind === "group") return "group";
  return "dm";
}

export type VoiceInvitePayload = {
  room_id?: string;
  call_id?: string;
  caller_id?: string;
  caller_name?: string;
  target_user_id?: string;
  call_kind?: string;
  room_name?: string;
  user_id?: string;
};

type IncomingState = Extract<VoiceCallState, { status: "incoming" }>;

export function voiceEventForUser(data: VoiceInvitePayload, currentUserId: string, allowedRoomIds: ReadonlySet<string>): boolean {
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
 * come back as "incoming" when the app reconnects.
 */
export function latestRingingInvite(invites: readonly PendingChatVoiceInvite[], now: number = Date.now()): PendingChatVoiceInvite | null {
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
