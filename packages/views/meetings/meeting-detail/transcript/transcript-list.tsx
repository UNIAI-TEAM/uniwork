"use client";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingRecording, MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { recordingOffset } from "../../meeting-recording-offset";
import { TranscriptFold, TranscriptLine } from "../../transcript/meeting-transcript-lines";
import type { TranscriptChange } from "../../transcript/transcript-change-dialog";
import { clock } from "../format";
import { useChapterTitle } from "./chapter-bar";
import { chapterBlocks, chapterIndexAt, type Chapter, type Citation } from "./transcript-model";

type Row = MeetingTranscriptSegment;

/** DOM id of a chapter's block, for the chapter bar's jumps. */
export const chapterAnchor = (key: string) => `transcript-${key}`;

/**
 * The lines, one block per chapter under its sticky divider (kit
 * `.tchapter`), folded around the active hit while a search runs.
 */
export function TranscriptList({
  rows,
  allRows,
  chapters,
  hits,
  active,
  query,
  phrase,
  expanded,
  onExpand,
  speakerOf,
  target,
  cited,
  onCite,
  recordings,
  canClerk,
  onPlay,
  onChange,
  head,
}: {
  /** The lines the filters keep. */
  rows: readonly Row[];
  /** Every loaded line (a stretch deleted from a line runs over all of them). */
  allRows: readonly Row[];
  chapters: readonly Chapter[];
  hits: ReadonlySet<number>;
  active: number;
  query: string;
  phrase: boolean;
  expanded: ReadonlySet<string>;
  onExpand: (key: string) => void;
  speakerOf: (s: Row) => string;
  target: string;
  cited: ReadonlyMap<string, Citation[]>;
  onCite: (c: Citation) => void;
  recordings: readonly MeetingRecording[];
  canClerk: boolean;
  onPlay: (at: { recordingId: string; seconds: number }) => void;
  onChange: (change: TranscriptChange) => void;
  /** Above the first line: a live meeting's "earlier lines" button. */
  head?: ReactNode;
}) {
  const { t } = useTranslation();
  const titleOf = useChapterTitle();
  const searching = query.trim() !== "";
  // Lines bucketed by chapter in time order; no chapters: one block with no divider.
  const groups: { chapter: Chapter | null; from: number; rows: Row[] }[] = [];
  rows.forEach((row, i) => {
    const chapter = chapters.length > 0 ? chapters[chapterIndexAt(chapters, row.spoken_at)]! : null;
    const last = groups[groups.length - 1];
    if (last && last.chapter === chapter) last.rows.push(row);
    else groups.push({ chapter, from: i, rows: [row] });
  });
  const drawn = groups.flatMap((g) => {
    const key = g.chapter?.key ?? "all";
    const blocks = chapterBlocks({ rows: g.rows, from: g.from, hits, active, searching, expanded, chapterKey: key });
    return blocks ? [{ ...g, key, blocks }] : [];
  });

  return (
    <div data-testid="meeting-transcript" className="flex flex-col gap-4">
      {head}
      {searching && hits.size === 0 ? (
        <p role="status" className="text-body text-muted-foreground">
          {t("meetings.transcriptNoMatch")}
        </p>
      ) : null}
      {drawn.map((g) => {
        let previous = "";
        return (
          <div key={g.key} id={chapterAnchor(g.key)} className="scroll-mt-2">
            {g.chapter ? (
              <h3 className="sticky top-0 z-2 mb-1 flex items-baseline gap-1.5 bg-background pt-2.5 pb-2 text-caption font-medium text-muted-foreground">
                <time className="font-mono">{clock(new Date(g.chapter.startMs).toISOString())}</time>
                {/* Kit `.chapter-div`: the title is a bare text run after the time. */}
                {` · ${titleOf(g.chapter)}`}
                <span className="ml-auto shrink-0 font-normal @max-[37.5rem]/meeting:hidden">
                  {t("meetings.detail.transcript.lineCount", { count: g.chapter.count ?? 0 })}
                </span>
              </h3>
            ) : null}
            <ol aria-label={g.chapter ? titleOf(g.chapter) : t("meetings.transcriptTitle")} className="flex flex-col gap-0.5">
              {g.blocks.map((b) => {
                if (b.kind === "fold") {
                  previous = "";
                  return <TranscriptFold key={b.key} rows={b.rows} side={b.side} hits={b.hits} onExpand={() => onExpand(b.key)} />;
                }
                const s = b.row;
                const speaker = speakerOf(s);
                const showSpeaker = speaker !== previous;
                previous = speaker;
                return (
                  <TranscriptLine
                    key={s.id}
                    segment={s}
                    speaker={speaker}
                    showSpeaker={showSpeaker}
                    query={hits.has(b.index) ? query : ""}
                    phrase={phrase}
                    activeHit={b.index === active}
                    target={s.id === target}
                    citations={cited.get(s.id) ?? []}
                    onCite={onCite}
                    play={recordingOffset(s.spoken_at, recordings)}
                    canClerk={canClerk}
                    onPlay={onPlay}
                    onChange={(kind) =>
                      onChange(
                        kind === "range" ? { kind, segment: s, after: allRows.slice(allRows.indexOf(s) + 1) } : { kind, segment: s },
                      )
                    }
                  />
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
