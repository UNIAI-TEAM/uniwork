export const MEETING_TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "UTC",
  "Europe/London",
  "America/Los_Angeles",
] as const;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function splitIsoLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return {
      date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
      time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    };
  }
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

export function combineLocalIso(date: string, time: string): string {
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function formatMeetingRange(startsAt: string, endsAt: string, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  };
  try {
    return `${new Date(startsAt).toLocaleString("vi-VN", opts)} – ${new Date(endsAt).toLocaleString("vi-VN", opts)}`;
  } catch {
    return `${new Date(startsAt).toLocaleString("vi-VN")} – ${new Date(endsAt).toLocaleString("vi-VN")}`;
  }
}

/** Remaining time until `endsAt` as `HH:MM:SS`. Null when the stamp is unusable. */
export function formatRemaining(endsAt: string, nowMs = Date.now()): string | null {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  const totalSec = Math.max(0, Math.floor((end - nowMs) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function defaultScheduleDraft(): { date: string; start: string; end: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    date: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`,
    start: `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
    end: `${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
  };
}
