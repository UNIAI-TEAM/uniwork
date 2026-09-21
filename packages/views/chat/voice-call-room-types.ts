export type VoiceCallParticipantTile = {
  identity: string;
  name: string;
  isLocal: boolean;
  hasVideo: boolean;
  hasScreenShare: boolean;
  /** LiveKit's active-speaker flag, refreshed on ActiveSpeakersChanged. */
  isSpeaking?: boolean;
  /** The participant's microphone is off (muted or not published). */
  micMuted?: boolean;
};

export function participantScreenShareKey(identity: string): string {
  return `${identity}:screen`;
}

export const VOICE_CALL_CONNECT_TIMEOUT_MS = 25_000;
