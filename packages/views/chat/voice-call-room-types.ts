export type VoiceCallParticipantTile = {
  identity: string;
  name: string;
  isLocal: boolean;
  hasVideo: boolean;
  hasScreenShare: boolean;
};

export function participantScreenShareKey(identity: string): string {
  return `${identity}:screen`;
}

export const VOICE_CALL_CONNECT_TIMEOUT_MS = 25_000;
