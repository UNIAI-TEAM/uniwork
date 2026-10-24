"use client";
import { ChevronRight, Ellipsis, PenLine, Scissors, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { clock } from "../meeting-detail/format";
import { citeAnchor, type Citation } from "../meeting-detail/transcript/transcript-model";
import type { TranscriptChange } from "./transcript-change-dialog";
import { highlightTranscript } from "./transcript-search";

/** The transcript row grid (kit `.tline`): time 56 · speaker 96 · text · ⋯ 28; a phone stacks the speaker over the text. */
const LINE_GRID =
  "grid grid-cols-[56px_96px_minmax(0,1fr)_28px] @max-[37.5rem]/meeting:grid-cols-[52px_minmax(0,1fr)_28px]";
const GUTTER = "font-mono text-caption font-medium text-muted-foreground";
/** Kit `.menu-item`: 36 tall, 10 in, body text. */
const MENU_ITEM = "h-9 gap-2 px-2.5 text-body";

/**
 * One transcript line (AfterTranscript): its time (a play button when a
 * recording covers it), the speaker once per run, the text with the search's
 * marks, a cited line's rule and back-links, and for a clerk the hover ⋯ to
 * correct or delete it. `target` is a cited line a deep link opened.
 */
export function TranscriptLine({
  segment: s,
  speaker,
  showSpeaker,
  query,
  phrase,
  activeHit,
  target,
  citations,
  onCite,
  play,
  canClerk,
  onPlay,
  onChange,
}: {
  segment: MeetingTranscriptSegment;
  speaker: string;
  /** The speaker changed since the line drawn above (else the name is for screen readers only). */
  showSpeaker: boolean;
  query: string;
  /** The search reads `query` as one phrase (transcriptPhraseSearch). */
  phrase: boolean;
  activeHit: boolean;
  target: boolean;
  citations: readonly Citation[];
  onCite: (c: Citation) => void;
  play: { recordingId: string; seconds: number } | null;
  canClerk: boolean;
  onPlay: (at: { recordingId: string; seconds: number }) => void;
  onChange: (kind: "edit" | "delete" | "range") => void;
}) {
  const { t } = useTranslation();
  const time = clock(s.spoken_at);
  const cited = citations.length > 0;
  const citeLabel = (c: Citation) =>
    c.kind === "decision"
      ? t("meetings.detail.transcript.citedDecision", { n: c.n })
      : c.kind === "question"
        ? t("meetings.detail.transcript.citedQuestion", { n: c.n })
        : t("meetings.detail.transcript.citedItem", { title: c.title ?? "" });
  return (
    <li
      data-segment-id={s.id}
      aria-current={target ? "true" : undefined}
      tabIndex={target ? -1 : undefined}
      className={cn(
        LINE_GRID,
        "group/line relative scroll-mt-12 rounded-sm py-1.5",
        cited
          ? "-ml-2 rounded-l-none bg-surface-selected/60 pl-2 shadow-[inset_2px_0_0_var(--primary)]"
          : "hover:bg-surface-hover hover:shadow-[-8px_0_0_var(--surface-hover)] has-[[aria-expanded=true]]:bg-surface-hover has-[[aria-expanded=true]]:shadow-[-8px_0_0_var(--surface-hover)]",
        target && !cited && "bg-surface-hover shadow-[-8px_0_0_var(--surface-hover)]",
      )}
    >
      {play ? (
        <button
          type="button"
          aria-label={t("meetings.transcriptPlayAt", { time })}
          onClick={() => onPlay(play)}
          className={cn(GUTTER, "col-start-1 row-start-1 self-start justify-self-start pt-0.5 hover:text-foreground hover:underline @max-[37.5rem]/meeting:row-[1/span_2]")}
        >
          <time dateTime={s.spoken_at}>{time}</time>
        </button>
      ) : (
        <time dateTime={s.spoken_at} className={cn(GUTTER, "col-start-1 row-start-1 pt-0.5 @max-[37.5rem]/meeting:row-[1/span_2]")}>
          {time}
        </time>
      )}
      {showSpeaker ? (
        <span className="col-start-2 row-start-1 pr-3 text-label leading-5 font-semibold">{speaker}</span>
      ) : (
        <span className="sr-only">{speaker}</span>
      )}
      <p className="col-start-3 max-w-155 text-body @max-[37.5rem]/meeting:col-start-2">
        {highlightTranscript(s.text, query, activeHit, phrase)}
        {s.edited_at ? <span className="ml-1.5 text-caption text-muted-foreground italic">{t("meetings.transcriptEdited")}</span> : null}
      </p>
      {canClerk ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={t("meetings.transcriptLineActions", { speaker, time })}
                className="relative col-start-4 row-start-1 -mt-1 inline-grid size-7 place-items-center self-start rounded-md text-muted-foreground opacity-0 group-hover/line:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 aria-expanded:bg-muted aria-expanded:text-foreground aria-expanded:opacity-100 pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-2 @max-[37.5rem]/meeting:col-start-3 @max-[37.5rem]/meeting:row-[1/span_2]"
              />
            }
          >
            <Ellipsis aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-50">
            <DropdownMenuItem className={MENU_ITEM} onClick={() => onChange("edit")}>
              <PenLine aria-hidden className="size-4" />
              {t("meetings.detail.transcript.editLine")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" className={MENU_ITEM} onClick={() => onChange("delete")}>
              <X aria-hidden className="size-4" />
              {t("meetings.detail.transcript.deleteLine")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" className={MENU_ITEM} onClick={() => onChange("range")}>
              <Scissors aria-hidden className="size-4" />
              {t("meetings.transcriptDeleteFromHere")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {cited ? (
        <p className="col-start-3 mt-0.5 text-caption text-primary @max-[37.5rem]/meeting:col-start-2">
          {citations.map((c, i) => (
            <span key={`${c.kind}-${c.n}`}>
              {i > 0 ? ", " : null}
              {/* Kit `.cited-by`: the first link carries the "Được dẫn ở:" lead, as one string. */}
              <a
                href={`#${citeAnchor(c.kind)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onCite(c);
                }}
                className="inline-block rounded-xs underline-offset-2 hover:underline"
              >
                {i === 0 ? `${t("meetings.detail.transcript.citedBy")} ${citeLabel(c)}` : citeLabel(c)}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Lines a search did not draw (kit `.fold`), with how many there are, when
 * they were said and how many hits they hold; a click draws them.
 */
export function TranscriptFold({
  rows,
  side,
  hits,
  onExpand,
}: {
  rows: readonly MeetingTranscriptSegment[];
  side: "before" | "after" | "all";
  hits: number;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;
  const vars = { count: rows.length, from: clock(first.spoken_at), to: clock(last.spoken_at) };
  const label =
    t(`meetings.detail.transcript.fold_${side}`, vars) +
    (hits > 0 ? ` · ${t("meetings.detail.transcript.foldHits", { count: hits })}` : "");
  return (
    <li className={cn(LINE_GRID, "min-h-8 items-center")}>
      <time dateTime={first.spoken_at} className={cn(GUTTER, "col-start-1")}>
        {clock(first.spoken_at)}
      </time>
      <button
        type="button"
        aria-expanded="false"
        onClick={onExpand}
        className="col-start-3 -ml-2 inline-flex h-7 items-center gap-1 self-start justify-self-start rounded-md px-2 text-caption font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground @max-[37.5rem]/meeting:col-start-2"
      >
        {label}
        <ChevronRight aria-hidden className="size-3" />
      </button>
    </li>
  );
}
