"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Ellipsis, Pencil, Play, Scissors, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingRecording, MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import { foldedIncludes } from "@uniwork/core/chat/search-fold";
import { recordingOffset } from "../meeting-recording-offset";
import { MeetingFeedLoadOlder } from "../meeting-feed-load-older";
import type { TranscriptReader } from "./use-transcript-reader";
import type { TranscriptChange } from "./transcript-change-dialog";
import { highlightTranscript } from "./transcript-search";

const ALL_SPEAKERS = "__all";

/**
 * The transcript's lines (UNI-1995 #14): a search over what is loaded (each
 * match marked), a speaker filter, each line's time a button that plays the
 * recording from that moment, and for a clerk the line's edit and delete
 * actions. `target` is a cited line to bring into view and mark.
 */
export function MeetingTranscriptLines({
  reader,
  recordings,
  canClerk,
  target,
  speakerOf,
  clock,
  onPlay,
  onChange,
}: {
  reader: TranscriptReader;
  recordings: readonly MeetingRecording[];
  canClerk: boolean;
  target: string;
  speakerOf: (s: MeetingTranscriptSegment) => string;
  clock: (iso: string) => string;
  onPlay: (at: { recordingId: string; seconds: number }) => void;
  onChange: (change: TranscriptChange) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState(ALL_SPEAKERS);
  const list = useRef<HTMLOListElement>(null);
  const rows = reader.rows;
  const speakers = useMemo(() => [...new Set(rows.map(speakerOf))].sort((a, b) => a.localeCompare(b)), [rows, speakerOf]);
  const filtering = query.trim() !== "" || speaker !== ALL_SPEAKERS;
  const shown = useMemo(
    () => rows.filter((s) => (speaker === ALL_SPEAKERS || speakerOf(s) === speaker) && foldedIncludes(s.text, query)),
    [rows, speaker, speakerOf, query],
  );
  const partial = reader.hasOlder || reader.hasNewer;

  // A cited line: once it is loaded, into the middle of the box, with focus.
  useEffect(() => {
    if (!target) return;
    const line = list.current?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(target)}"]`);
    if (!line) return;
    line.scrollIntoView({ block: "center" });
    line.focus({ preventScroll: true });
  }, [target, rows]);

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("meetings.transcriptSearchPlaceholder")}
          aria-label={t("meetings.transcriptSearchLabel")}
          className="w-full min-w-0 sm:max-w-xs"
        />
        {speakers.length > 1 ? (
          <div className="w-full sm:w-56">
            <Select
              aria-label={t("meetings.transcriptSpeakerLabel")}
              value={speaker}
              onValueChange={(next) => typeof next === "string" && setSpeaker(next)}
              items={[
                { value: ALL_SPEAKERS, label: t("meetings.transcriptSpeakerAll") },
                ...speakers.map((name) => ({ value: name, label: name })),
              ]}
            />
          </div>
        ) : null}
      </div>
      {filtering ? (
        <p role="status" className="text-caption text-muted-foreground">
          {shown.length === 0
            ? t("meetings.transcriptNoMatch")
            : t(partial ? "meetings.transcriptMatchesPartial" : "meetings.transcriptMatches", { count: shown.length })}
        </p>
      ) : null}
      {/* Scrolls on its own so a long meeting does not push the page. */}
      <ol
        ref={list}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus so a keyboard can scroll it (axe scrollable-region-focusable)
        tabIndex={0}
        aria-label={t("meetings.transcriptTitle")}
        className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-border p-3"
        data-testid="meeting-transcript"
      >
        {reader.hasOlder ? (
          <li>
            <MeetingFeedLoadOlder label={t("meetings.transcriptLoadOlder")} loading={reader.isLoadingOlder} onLoad={reader.loadOlder} />
          </li>
        ) : null}
        {shown.map((s) => (
          <TranscriptLine
            key={s.id}
            segment={s}
            speaker={speakerOf(s)}
            time={clock(s.spoken_at)}
            query={query}
            active={s.id === target}
            play={recordingOffset(s.spoken_at, recordings)}
            canClerk={canClerk}
            onPlay={onPlay}
            onChange={(kind) =>
              onChange(kind === "range" ? { kind, segment: s, after: rows.slice(rows.indexOf(s) + 1) } : { kind, segment: s })
            }
          />
        ))}
        {reader.hasNewer ? (
          <li>
            <MeetingFeedLoadOlder label={t("meetings.transcriptLoadNewer")} loading={reader.isLoadingNewer} onLoad={reader.loadNewer} />
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function TranscriptLine({
  segment: s,
  speaker,
  time,
  query,
  active,
  play,
  canClerk,
  onPlay,
  onChange,
}: {
  segment: MeetingTranscriptSegment;
  speaker: string;
  time: string;
  query: string;
  active: boolean;
  play: { recordingId: string; seconds: number } | null;
  canClerk: boolean;
  onPlay: (at: { recordingId: string; seconds: number }) => void;
  onChange: (kind: "edit" | "delete" | "range") => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      data-segment-id={s.id}
      tabIndex={active ? -1 : undefined}
      className={cn("group flex items-start gap-2 rounded-md text-body text-foreground", active && "bg-accent ring-2 ring-ring/40")}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-caption text-muted-foreground">
          <span className="font-medium">{speaker}</span>
          {time ? (
            play ? (
              <Button
                type="button"
                size="xs"
                variant="link"
                className="h-auto px-0 tabular-nums"
                aria-label={t("meetings.transcriptPlayAt", { time })}
                onClick={() => onPlay(play)}
              >
                <Play aria-hidden />
                <time dateTime={s.spoken_at}>{time}</time>
              </Button>
            ) : (
              <time dateTime={s.spoken_at} className="tabular-nums">
                {time}
              </time>
            )
          ) : null}
          {s.edited_at ? <span className="italic">{t("meetings.transcriptEdited")}</span> : null}
        </p>
        <p className="text-pretty">{highlightTranscript(s.text, query)}</p>
      </div>
      {canClerk ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("meetings.transcriptLineActions", { speaker, time })}
              />
            }
          >
            <Ellipsis aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => onChange("edit")}>
              <Pencil aria-hidden className="size-4" />
              {t("meetings.transcriptEditLine")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onChange("delete")}>
              <Trash2 aria-hidden className="size-4" />
              {t("meetings.transcriptDeleteLine")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onChange("range")}>
              <Scissors aria-hidden className="size-4" />
              {t("meetings.transcriptDeleteFromHere")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}
