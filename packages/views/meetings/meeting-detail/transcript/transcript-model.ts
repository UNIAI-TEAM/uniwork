/**
 * Pure rules of the transcript tab (AfterTranscript board): chapters from the
 * summary's topics, speaker counts, which lines the page cites, and which
 * lines a search draws (the rest fold).
 */
import type { MeetingEvidenceRef } from "@uniwork/core/types/meeting";

type Line = { id: string; spoken_at: string };

export type Chapter = {
  key: string;
  /** null: the opening stretch before the first topic ("Mở đầu"). */
  title: string | null;
  startMs: number;
  endMs: number;
  /** Whole minutes, at least 1: the chapter bar's proportions. */
  minutes: number;
  /** Lines said in it; null while the transcript is not loaded (the rail then shows times only). */
  count: number | null;
  /** Wide enough for its label in the chapter bar (at least 5% of the meeting). */
  showLabel: boolean;
};

const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
/** A topic that starts this close to the meeting's start leaves no opening chapter. */
const OPENING_MIN_MS = 30_000;

/**
 * The meeting split at each topic's `start_at`, with an opening chapter when
 * lines were said before the first topic. No topics with a time: no chapters
 * (the bar and the dividers are not drawn). Lines before the start count in
 * the first chapter, lines after the end in the last.
 */
export function transcriptChapters({
  topics,
  startIso,
  endIso,
  rows,
}: {
  topics: readonly { title: string; start_at?: string | null }[];
  startIso?: string;
  endIso?: string;
  rows: readonly Line[] | undefined;
}): Chapter[] {
  const starts = topics
    .map((tp) => ({ title: tp.title, ms: at(tp.start_at) }))
    .filter((tp) => Number.isFinite(tp.ms))
    .sort((a, b) => a.ms - b.ms);
  if (starts.length === 0) return [];
  const times = (rows ?? []).map((r) => at(r.spoken_at)).filter(Number.isFinite);
  const begin = Number.isFinite(at(startIso)) ? at(startIso) : Math.min(starts[0]!.ms, ...times);
  const finish = Math.max(Number.isFinite(at(endIso)) ? at(endIso) : -Infinity, ...times, starts[starts.length - 1]!.ms);
  const spans: { title: string | null; ms: number }[] =
    starts[0]!.ms - begin >= OPENING_MIN_MS ? [{ title: null, ms: begin }, ...starts] : starts;
  const total = Math.max(1, finish - spans[0]!.ms);
  return spans.map((span, i) => {
    const end = spans[i + 1]?.ms ?? finish;
    const first = i === 0;
    const last = i === spans.length - 1;
    const count = rows ? times.filter((ms) => (first || ms >= span.ms) && (last || ms < end)).length : null;
    return {
      key: `chapter-${i}`,
      title: span.title,
      startMs: span.ms,
      endMs: end,
      minutes: Math.max(1, Math.round((end - span.ms) / 60_000)),
      count,
      showLabel: (end - span.ms) / total >= 0.05,
    };
  });
}

/** The chapter a moment falls in (index), clamped to the first and last. */
export function chapterIndexAt(chapters: readonly Chapter[], iso: string): number {
  const ms = at(iso);
  let index = 0;
  chapters.forEach((c, i) => {
    if (ms >= c.startMs) index = i;
  });
  return index;
}

export type SpeakerCount = { name: string; count: number; participantId?: string };

/** Who spoke how often: most lines first, ties in order of first appearance. */
export function speakerCounts<R extends { participant_id?: string }>(rows: readonly R[], nameOf: (r: R) => string): SpeakerCount[] {
  const tally = new Map<string, SpeakerCount>();
  for (const r of rows) {
    const name = nameOf(r);
    const entry = tally.get(name) ?? { name, count: 0, participantId: r.participant_id };
    entry.count += 1;
    tally.set(name, entry);
  }
  return [...tally.values()].sort((a, b) => b.count - a.count);
}

export type Citation = { kind: "decision" | "question" | "item"; n: number; title?: string };

/** Where a back-link lands on Tổng quan: the overview section's id. */
export function citeAnchor(kind: Citation["kind"]): string {
  return kind === "decision" ? "decisions" : kind === "question" ? "open-questions" : "action-items";
}

type Cited = { text?: string; evidence: readonly MeetingEvidenceRef[] };

/**
 * The lines the overview cites, by segment id: the line each decision, open
 * question and action item opens on (its first evidence ref, the line its
 * time chip shows). Dismissed items do not count; topics are not cited.
 */
export function citedLines({
  decisions = [],
  questions = [],
  items = [],
}: {
  decisions?: readonly Cited[];
  questions?: readonly Cited[];
  items?: readonly (Cited & { title: string; status: string })[];
}): Map<string, Citation[]> {
  const out = new Map<string, Citation[]>();
  const add = (refs: readonly MeetingEvidenceRef[], citation: Citation) => {
    const first = refs[0];
    if (first?.kind !== "segment") return;
    out.set(first.id, [...(out.get(first.id) ?? []), citation]);
  };
  decisions.forEach((d, i) => add(d.evidence, { kind: "decision", n: i + 1 }));
  questions.forEach((q, i) => add(q.evidence, { kind: "question", n: i + 1 }));
  items.filter((it) => it.status !== "DISMISSED").forEach((it, i) => add(it.evidence, { kind: "item", n: i + 1, title: it.title }));
  return out;
}

/** Lines a search draws around the active hit: 6 before it and 5 after. */
const BEFORE = 6;
const AFTER = 5;

export type Block<R> =
  | { kind: "line"; row: R; index: number }
  | { kind: "fold"; key: string; side: "before" | "after" | "all"; rows: R[]; hits: number };

/**
 * One chapter's lines as drawn. Without a search every line shows. With one,
 * a chapter without hits is not drawn (null), the active hit's chapter shows
 * the lines around it with the rest folded before and after, and any other
 * chapter with hits is one fold. `index` is the line's position in the
 * filtered list; an expanded fold key draws its lines.
 */
export function chapterBlocks<R>({
  rows,
  from,
  hits,
  active,
  searching,
  expanded,
  chapterKey,
}: {
  /** The chapter's lines in the filtered list. */
  rows: readonly R[];
  /** Position of `rows[0]` in the filtered list. */
  from: number;
  /** Positions of the lines that match, in the filtered list. */
  hits: ReadonlySet<number>;
  /** Position of the active hit, or -1. */
  active: number;
  searching: boolean;
  expanded: ReadonlySet<string>;
  chapterKey: string;
}): Block<R>[] | null {
  const lines = (lo: number, hi: number): Block<R>[] =>
    rows.slice(lo, hi).map((row, i) => ({ kind: "line", row, index: from + lo + i }));
  if (!searching) return lines(0, rows.length);
  const hitCount = (lo: number, hi: number) => [...hits].filter((h) => h >= from + lo && h < from + hi).length;
  if (hitCount(0, rows.length) === 0) return null;
  const fold = (side: "before" | "after" | "all", lo: number, hi: number): Block<R>[] => {
    if (hi <= lo) return [];
    const key = `${chapterKey}:${side}`;
    if (expanded.has(key)) return lines(lo, hi);
    return [{ kind: "fold", key, side, rows: rows.slice(lo, hi), hits: hitCount(lo, hi) }];
  };
  const local = active - from;
  if (local < 0 || local >= rows.length) return fold("all", 0, rows.length);
  const lo = Math.max(0, local - BEFORE);
  const hi = Math.min(rows.length, local + AFTER + 1);
  return [...fold("before", 0, lo), ...lines(lo, hi), ...fold("after", hi, rows.length)];
}
