import type { useTranslation } from "react-i18next";
import type { SummarySourceTimes } from "../../meeting-summary/summary-sources";

type TFunction = ReturnType<typeof useTranslation>["t"];

type SourceCounts = { transcript: number; notes: number; chat: number; votes: number };

/**
 * How many rows of each source the summary could read: those stamped at or
 * before `cutoff` (the summary's `created_at`), or all of them without one
 * (what a summary made now would read).
 */
export function sourceCounts(times: SummarySourceTimes, cutoff?: string | null): SourceCounts {
  const limit = cutoff ? Date.parse(cutoff) : Number.NaN;
  const count = (rows: SummarySourceTimes[keyof SummarySourceTimes]) =>
    Number.isFinite(limit)
      ? rows.filter((iso) => {
          const at = iso ? Date.parse(iso) : Number.NaN;
          return Number.isFinite(at) && at <= limit;
        }).length
      : rows.length;
  return { transcript: count(times.transcript), notes: count(times.notes), chat: count(times.chat), votes: count(times.votes) };
}

/**
 * "119 câu thoại và 2 ghi chú" (or, `lead`, "Lời thoại 119 câu và 2 ghi
 * chú"): the non-empty sources as one localized list; empty when none.
 */
export function sourceWords(counts: SourceCounts, t: TFunction, locale: string, { lead = false } = {}): string {
  const base = "meetings.detail.overview.sources";
  const names = [
    counts.transcript > 0 ? t(lead ? `${base}.transcriptLead` : `${base}.transcript`, { count: counts.transcript }) : null,
    counts.notes > 0 ? t(`${base}.notes`, { count: counts.notes }) : null,
    counts.chat > 0 ? t(`${base}.chat`, { count: counts.chat }) : null,
    counts.votes > 0 ? t(`${base}.votes`, { count: counts.votes }) : null,
  ].filter((name): name is string => name !== null);
  if (names.length === 0) return "";
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

