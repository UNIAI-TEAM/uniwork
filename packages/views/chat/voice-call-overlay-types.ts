export type VoiceCallKind = "dm" | "group" | "channel";

export type VoiceCallDeviceKind = "audioinput" | "videoinput";

/** The same four buckets the meeting room's device notice uses. */
export type VoiceCallDeviceFailure = "denied" | "in_use" | "missing" | "other";

export type VoiceCallDeviceError = { kind: VoiceCallDeviceKind; failure: VoiceCallDeviceFailure };

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

export type VoiceCallEndInit = {
  reason: VoiceCallEndReason;
  error?: unknown;
  device?: VoiceCallDeviceError;
};

/** Why the media room let go of us, in terms the call state understands. */
export type VoiceCallDisconnectInfo = {
  /** The same user joined from another tab or device and took the seat. */
  movedElsewhere?: boolean;
};

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
  device?: VoiceCallDeviceError;
};

export type VoiceCallOverlayState =
  | { status: "idle" }
  | {
      status: "incoming";
      callId: string;
      roomId: string;
      peerName: string;
      callKind: VoiceCallKind;
      callerName?: string;
    }
  | {
      status: "ringing";
      callId: string;
      roomId: string;
      peerName: string;
      outgoing: true;
      callKind: VoiceCallKind;
      withCamera?: boolean;
    }
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
  return (
    reason === "peer_ended" ||
    reason === "peer_left" ||
    reason === "alone" ||
    reason === "everyone_left" ||
    reason === "declined"
  );
}
