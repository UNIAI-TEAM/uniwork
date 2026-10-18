const UNITS = ["KB", "MB", "GB"];

function clean(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

/** -1 for bytes, else the index in UNITS a size reads in. */
function unitOf(bytes: number): number {
  if (bytes < 1024) return -1;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit;
}

function formatIn(bytes: number, unit: number, locale: string): string {
  if (unit < 0) return bytes.toLocaleString(locale);
  const digits = unit === 0 ? 0 : 1;
  return (bytes / 1024 ** (unit + 1)).toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * "12 B", "48 KB", "1,2 MB" in the reader's locale: Vietnamese writes the
 * decimal with a comma, and a file size is read, not parsed. Kilobytes are
 * whole; larger units keep one decimal (canvas).
 */
export function formatChatFileSize(bytes: number, locale: string): string {
  const safe = clean(bytes);
  const unit = unitOf(safe);
  return `${formatIn(safe, unit, locale)} ${unit < 0 ? "B" : UNITS[unit]}`;
}

/** "1,3 / 2,1 MB": what has arrived, in the unit of the whole (canvas). */
export function formatChatFileProgress(loaded: number, total: number, locale: string): string {
  const whole = clean(total);
  return `${formatIn(Math.min(clean(loaded), whole), unitOf(whole), locale)} / ${formatChatFileSize(whole, locale)}`;
}
