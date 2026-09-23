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

/**
 * Active-speaker updates arrive several times a second; most change nothing
 * a tile shows. Keeping the previous array then skips the re-render.
 */
export function sameParticipantTiles(
  a: readonly VoiceCallParticipantTile[],
  b: readonly VoiceCallParticipantTile[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((tile, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      tile.identity === other.identity &&
      tile.name === other.name &&
      tile.isLocal === other.isLocal &&
      tile.hasVideo === other.hasVideo &&
      tile.hasScreenShare === other.hasScreenShare &&
      Boolean(tile.isSpeaking) === Boolean(other.isSpeaking) &&
      Boolean(tile.micMuted) === Boolean(other.micMuted)
    );
  });
}
