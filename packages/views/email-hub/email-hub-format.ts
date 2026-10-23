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

const emailDateTimeFormatOptions = {
  listTime: { hour: "2-digit", minute: "2-digit" },
  listMonthDay: { day: "numeric", month: "short" },
  listFullDate: { day: "2-digit", month: "2-digit", year: "numeric" },
  fullDate: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  fullTime: { hour: "2-digit", minute: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

type EmailDateTimeFormatKey = keyof typeof emailDateTimeFormatOptions;

const emailDateTimeFormatters = new Map<string, Map<EmailDateTimeFormatKey, Intl.DateTimeFormat>>();

function formatEmailDateTime(date: Date, locale: string, key: EmailDateTimeFormatKey): string {
  let localeFormatters = emailDateTimeFormatters.get(locale);
  if (!localeFormatters) {
    localeFormatters = new Map();
    emailDateTimeFormatters.set(locale, localeFormatters);
  }
  let formatter = localeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, emailDateTimeFormatOptions[key]);
    localeFormatters.set(key, formatter);
  }
  return formatter.format(date);
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
    return formatEmailDateTime(d, locale, "listTime");
  }
  if (d.getFullYear() === now.getFullYear()) {
    return formatEmailDateTime(d, locale, "listMonthDay");
  }
  return formatEmailDateTime(d, locale, "listFullDate");
}

/**
 * The reading pane and schedules: weekday, date, then time. Built from two
 * parts because `toLocaleString` in vi-VN puts the time first ("18:43 Thứ 5, …").
 */
export function formatEmailFullDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = formatEmailDateTime(d, locale, "fullDate");
  const time = formatEmailDateTime(d, locale, "fullTime");
  return `${date} · ${time}`;
}

/** "470,8 KB" in Vietnamese, "470.8 KB" in English. */
export function formatBytes(size: number, locale: string) {
  const num = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (size < 1024) return `${num(size)} B`;
  if (size < 1024 * 1024) return `${num(size / 1024)} KB`;
  return `${num(size / (1024 * 1024))} MB`;
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
