import type { MeetingRecordingPlaybackSource } from "../api/endpoints/meetings";

type CachedPlayback = MeetingRecordingPlaybackSource & { cacheKey: string };

const playbackByKey = new Map<string, CachedPlayback>();

export function meetingRecordingPlaybackCacheKey(meetingId: string, recordingId: string): string {
  return `${meetingId}:${recordingId}`;
}

function isExpired(entry: CachedPlayback): boolean {
  if (entry.kind !== "remote" || !entry.expiresAt.trim()) return false;
  const expiresAt = Date.parse(entry.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() >= expiresAt - 30_000;
}

export function getCachedMeetingRecordingPlayback(cacheKey: string): CachedPlayback | null {
  const entry = playbackByKey.get(cacheKey);
  if (!entry) return null;
  if (isExpired(entry)) {
    releaseMeetingRecordingPlayback(cacheKey);
    return null;
  }
  return entry;
}

export function rememberMeetingRecordingPlayback(
  cacheKey: string,
  source: MeetingRecordingPlaybackSource,
): void {
  const prev = playbackByKey.get(cacheKey);
  if (prev && prev.url !== source.url && prev.kind === "blob") {
    URL.revokeObjectURL(prev.url);
  }
  playbackByKey.set(cacheKey, { ...source, cacheKey });
}

export function releaseMeetingRecordingPlayback(cacheKey: string): void {
  const entry = playbackByKey.get(cacheKey);
  if (!entry) return;
  if (entry.kind === "blob") URL.revokeObjectURL(entry.url);
  playbackByKey.delete(cacheKey);
}
