import type { useTranslation } from "react-i18next";

type TFunction = ReturnType<typeof useTranslation>["t"];

/** What the server reads to summarise a meeting (HasMeetingSummarySource). */
export type SummarySource = "transcript" | "notes" | "chat" | "votes";

const SOURCE_ORDER: readonly SummarySource[] = ["transcript", "notes", "chat", "votes"];

const SOURCE_KEYS: Readonly<Record<SummarySource, string>> = {
  transcript: "meetings.summaryAi.sourceTranscript",
  notes: "meetings.summaryAi.sourceNotes",
  chat: "meetings.summaryAi.sourceChat",
  votes: "meetings.summaryAi.sourceVotes",
};

/** The timestamps of each source's rows; a closed vote counts from when it closed. */
export interface SummarySourceTimes {
  transcript: readonly (string | null | undefined)[];
  notes: readonly (string | null | undefined)[];
  chat: readonly (string | null | undefined)[];
  votes: readonly (string | null | undefined)[];
}

/** Whether anything exists the server would summarise: the same four sources as the server's test. */
export function hasSummarySource(counts: Readonly<Record<SummarySource, number>>): boolean {
  return SOURCE_ORDER.some((s) => counts[s] > 0);
}

/**
 * What the summary can truthfully say about its inputs. The server keeps no
 * snapshot of what it read, so the sources are judged from what existed when
 * it was generated (by timestamp), and anything newer marks the summary stale.
 */
export function summarySourceFacts(
  generatedAt: string | null | undefined,
  times: SummarySourceTimes,
): { sources: SummarySource[]; stale: boolean } {
  const at = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  if (!Number.isFinite(at)) return { sources: [], stale: false };
  const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
  const sources = SOURCE_ORDER.filter((s) =>
    times[s].some((iso) => {
      const v = ms(iso);
      return Number.isFinite(v) && v <= at;
    }),
  );
  const stale = SOURCE_ORDER.some((s) =>
    times[s].some((iso) => {
      const v = ms(iso);
      return Number.isFinite(v) && v > at;
    }),
  );
  return { sources, stale };
}

/** "bản ghi lời thoại, ghi chú và tin nhắn": the sources as one localized list, null when none is known. */
export function summarySourceList(sources: readonly SummarySource[], t: TFunction, locale: string): string | null {
  if (sources.length === 0) return null;
  const names = sources.map((s) => t(SOURCE_KEYS[s]));
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}
