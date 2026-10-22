// The one place that decides how the app writes a date or a time:
// the app's own language, never the device's region (a phone set to English shows English dates, written
// day first — en-GB, as people in Vietnam read them), and the device's 12- or 24-hour clock, which the
// person chose in the system settings. lib/ stays free of native modules, so the clock arrives through
// setDeviceClock (components/app/i18n-provider.tsx reads expo-localization's calendar at start and again
// when the app comes back to the foreground). Formatters are cached: building one is the expensive part.

/** The app speaks vi and en; Vietnamese is the default for anything else. */
export function formatLocale(language: string | undefined): string {
  return language === "en" ? "en-GB" : "vi-VN";
}

let hour12: boolean | undefined;

/** The device's clock: true for 24-hour, false for 12-hour, null or undefined when unknown (the language's default). */
export function setDeviceClock(uses24hourClock: boolean | null | undefined): void {
  hour12 = uses24hourClock == null ? undefined : !uses24hourClock;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const FORMATTERS_MAX = 64;

/** A cached Intl.DateTimeFormat in the app's language; a format that shows the hour follows the device's clock. */
export function dateTimeFormat(language: string | undefined, options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  const clock = hour12 !== undefined && (options.hour !== undefined || options.timeStyle !== undefined) ? { hour12 } : {};
  const locale = formatLocale(language);
  const key = `${locale}|${JSON.stringify(options)}|${String(clock.hour12)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    if (formatters.size >= FORMATTERS_MAX) formatters.clear();
    formatter = new Intl.DateTimeFormat(locale, { ...options, ...clock });
    formatters.set(key, formatter);
  }
  return formatter;
}
