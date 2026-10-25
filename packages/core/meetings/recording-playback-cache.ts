import type { MeetingRecordingPlaybackSource } from "../api/endpoints/meetings";

type RemotePlayback = Extract<MeetingRecordingPlaybackSource, { kind: "remote" }>;

// Presigned URLs only: a blob holds the whole file in memory, so the dialog
// that made one revokes it when it closes instead of keeping it here.
const playbackByKey = new Map<string, RemotePlayback>();

export function meetingRecordingPlaybackCacheKey(meetingId: string, recordingId: string): string {
  return `${meetingId}:${recordingId}`;
}

function isExpired(entry: RemotePlayback): boolean {
  if (!entry.expiresAt.trim()) return false;
  const expiresAt = Date.parse(entry.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() >= expiresAt - 30_000;
}

export function getCachedMeetingRecordingPlayback(cacheKey: string): RemotePlayback | null {
  const entry = playbackByKey.get(cacheKey);
  if (!entry) return null;
  if (isExpired(entry)) {
    playbackByKey.delete(cacheKey);
    return null;
  }
  return entry;
}

export function rememberMeetingRecordingPlayback(cacheKey: string, source: RemotePlayback): void {
  playbackByKey.set(cacheKey, source);
}

export function releaseMeetingRecordingPlayback(cacheKey: string): void {
  playbackByKey.delete(cacheKey);
}
