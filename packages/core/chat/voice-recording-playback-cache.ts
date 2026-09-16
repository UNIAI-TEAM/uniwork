import type { ChatVoiceRecordingPlaybackSource } from "../api/endpoints/chat-voice";

type CachedPlayback = ChatVoiceRecordingPlaybackSource & { cacheKey: string };

const playbackByKey = new Map<string, CachedPlayback>();

export function voiceRecordingPlaybackCacheKey(
  workspaceId: string,
  roomId: string,
  recordingId: string,
): string {
  return `${workspaceId}:${roomId}:${recordingId}`;
}

function isExpired(entry: CachedPlayback): boolean {
  if (entry.kind !== "remote" || !entry.expiresAt.trim()) return false;
  const expiresAt = Date.parse(entry.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() >= expiresAt - 30_000;
}

export function getCachedVoiceRecordingPlayback(cacheKey: string): CachedPlayback | null {
  const entry = playbackByKey.get(cacheKey);
  if (!entry) return null;
  if (isExpired(entry)) {
    releaseVoiceRecordingPlayback(cacheKey);
    return null;
  }
  return entry;
}

export function rememberVoiceRecordingPlayback(
  cacheKey: string,
  source: ChatVoiceRecordingPlaybackSource,
): void {
  const prev = playbackByKey.get(cacheKey);
  if (prev && prev.url !== source.url && prev.kind === "blob") {
    URL.revokeObjectURL(prev.url);
  }
  playbackByKey.set(cacheKey, { ...source, cacheKey });
}

export function releaseVoiceRecordingPlayback(cacheKey: string): void {
  const entry = playbackByKey.get(cacheKey);
  if (!entry) return;
  if (entry.kind === "blob") URL.revokeObjectURL(entry.url);
  playbackByKey.delete(cacheKey);
}
