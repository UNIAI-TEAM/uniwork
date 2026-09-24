/** YYYY-MM-DD for date input when AI returns ISO or date prefix. */
export function dueHintToDateInput(due?: string): string | undefined {
  const raw = due?.trim();
  if (!raw) return undefined;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso?.[1]) return iso[1];
  return undefined;
}

/** Human-readable due line in lists (keep spoken text when not ISO). */
export function formatActionDueHint(due: string | undefined, locale: string): string | undefined {
  const raw = due?.trim();
  if (!raw) return undefined;
  const dateOnly = dueHintToDateInput(raw);
  if (dateOnly && raw.includes("T")) {
    try {
      return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-US" : "vi-VN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(raw));
    } catch {
      return raw;
    }
  }
  if (dateOnly) {
    // A bare date is a calendar day: build it locally so no timezone shifts it a day back.
    const [y, m, d] = dateOnly.split("-").map(Number);
    return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-US" : "vi-VN", { dateStyle: "medium" }).format(
      new Date(y!, m! - 1, d!),
    );
  }
  return raw;
}
