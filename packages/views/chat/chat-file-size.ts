/**
 * "12 B", "2,5 KB", "1,2 MB" in the reader's locale: Vietnamese writes the
 * decimal with a comma, and a file size is read, not parsed.
 */
export function formatChatFileSize(bytes: number, locale: string): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024) return `${safe.toLocaleString(locale)} B`;
  const units = ["KB", "MB", "GB"];
  let value = safe / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${units[unit]}`;
}
