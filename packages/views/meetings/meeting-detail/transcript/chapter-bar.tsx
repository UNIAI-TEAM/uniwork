"use client";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingSummary } from "@uniwork/core/meetings/summary";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import type { Meeting } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { clock } from "../format";
import { transcriptChapters, type Chapter } from "./transcript-model";

/**
 * The ended meeting's chapters: the summary's topics split at their
 * `start_at`, counted over the whole transcript. The transcript tab draws
 * them as the chapter bar and dividers; the rail's "Chương" outline reads the
 * same hook (both queries are cached, so nothing is fetched twice).
 */
export function useTranscriptChapters(meeting: Meeting, enabled = true): Chapter[] {
  const on = enabled && meeting.status === "ENDED";
  const summary = useMeetingSummary(on ? meeting.id : "").data;
  const rows = useFullTranscript(meeting.id, on).data;
  return useMemo(
    () =>
      on
        ? transcriptChapters({
            topics: summary?.topics ?? [],
            startIso: meeting.actual_start_at ?? meeting.starts_at,
            endIso: meeting.actual_end_at,
            rows,
          })
        : [],
    [on, summary?.topics, meeting.actual_start_at, meeting.starts_at, meeting.actual_end_at, rows],
  );
}

/** A chapter's name: its topic, or "Mở đầu" for the stretch before the first one. */
export function useChapterTitle(): (c: Chapter) => string {
  const { t } = useTranslation();
  return (c) => c.title ?? t("meetings.detail.transcript.opening");
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The chapter bar (kit `.chap-row`): the meeting's start and end times either
 * side of one segment per chapter, each as wide as its minutes. A segment
 * jumps to its chapter; the one being read is marked current.
 */
export function ChapterBar({
  chapters,
  current,
  onPick,
}: {
  chapters: readonly Chapter[];
  current: number;
  onPick: (index: number) => void;
}) {
  const { t } = useTranslation();
  const titleOf = useChapterTitle();
  const first = chapters[0];
  const last = chapters[chapters.length - 1];
  if (!first || !last) return null;
  const time = (ms: number) => (
    <time dateTime={iso(ms)} className="shrink-0 font-mono text-caption font-medium text-muted-foreground">
      {clock(iso(ms))}
    </time>
  );
  return (
    <div className="flex items-center gap-2.5">
      {time(first.startMs)}
      <nav aria-label={t("meetings.detail.transcript.chapters")} className="flex h-7 min-w-0 flex-1 gap-0.5">
        {chapters.map((c, i) => {
          const isCurrent = i === current;
          const start = clock(iso(c.startMs));
          return (
            <button
              key={c.key}
              type="button"
              style={{ flexGrow: c.minutes }}
              title={`${titleOf(c)} · ${start}`}
              aria-current={isCurrent ? "true" : undefined}
              aria-label={t(isCurrent ? "meetings.detail.transcript.chapterCurrent" : "meetings.detail.transcript.chapterLabel", {
                title: titleOf(c),
                time: start,
                count: c.count ?? 0,
              })}
              onClick={() => onPick(i)}
              className={cn(
                "group/chap flex min-w-0 basis-0 items-center overflow-hidden rounded-sm bg-muted text-left text-caption whitespace-nowrap text-muted-foreground hover:bg-border hover:text-foreground",
                "aria-[current=true]:bg-surface-selected aria-[current=true]:text-brand-subtle-foreground",
              )}
            >
              {c.showLabel ? (
                <span
                  className={cn(
                    "truncate px-1.5",
                    // A phone keeps only the current and the last labels.
                    !isCurrent && i < chapters.length - 1 && "@max-[37.5rem]/meeting:hidden",
                  )}
                >
                  {isCurrent ? (
                    <span className="@max-[37.5rem]/meeting:hidden">
                      <time className="font-mono font-medium">{start}</time>
                      {" · "}
                    </span>
                  ) : null}
                  {titleOf(c)}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      {time(last.endMs)}
    </div>
  );
}
