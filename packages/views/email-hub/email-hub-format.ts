/**
 * Dates, names and sizes for Email Hub, formatted in the app's language rather
 * than the browser's: a Vietnamese UI on an en-US browser used to print
 * "Sep 24, 06:11 PM" next to Vietnamese labels.
 */

export function emailHubLocale(language: string | undefined): string {
  return language?.startsWith("en") ? "en-US" : "vi-VN";
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * The list column: today's mail shows only the time, this year's the day and
 * month, anything older the full date — the same scale a mail client uses, so
 * the column stays narrow and the recent rows are easy to tell apart.
 */
export function formatEmailListDate(iso: string, locale: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (sameDay(d, now)) {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * The reading pane and schedules: weekday, date, then time. Built from two
 * parts because `toLocaleString` in vi-VN puts the time first ("18:43 Thứ 5, …").
 */
export function formatEmailFullDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * First letter of the sender's name or address. Any letter counts — the old
 * ASCII-only match turned "Đỗ Thị Hà" into "T", the initial of her middle name.
 */
export function senderInitial(fromName?: string, fromAddr?: string) {
  const source = fromName?.trim() || fromAddr?.trim() || "";
  const letter = source.match(/[\p{L}\p{N}]/u)?.[0];
  return letter ? letter.toLocaleUpperCase() : "?";
}

/** "Trần Quang Minh" or, without a display name, the address itself. */
export function senderDisplayName(fromName?: string, fromAddr?: string) {
  return fromName?.trim() || fromAddr?.trim() || "";
}
