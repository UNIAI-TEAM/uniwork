import type { MeetingRecording } from "@uniwork/core/types/meeting";

/** Where in a recording a moment falls: the COMPLETE recording running then, and the second into it. */
export function recordingOffset(
  at: string | null | undefined,
  recordings: readonly MeetingRecording[],
): { recordingId: string; seconds: number } | null {
  const t = Date.parse(at ?? "");
  if (!Number.isFinite(t)) return null;
  for (const r of recordings) {
    const start = Date.parse(r.started_at ?? "");
    const end = Date.parse(r.ended_at ?? "");
    if (r.status !== "COMPLETE" || !Number.isFinite(start) || t < start || (Number.isFinite(end) && t > end)) continue;
    return { recordingId: r.id, seconds: Math.floor((t - start) / 1000) };
  }
  return null;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatOffset(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
