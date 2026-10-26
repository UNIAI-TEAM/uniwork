"use client";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "../../meeting-person";
import type { SpeakerCount } from "./transcript-model";

const ICON_BUTTON =
  // A 44 target on touch from an invisible overlay, so the field keeps the kit's 28px buttons.
  "relative inline-grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-muted pointer-coarse:after:absolute pointer-coarse:after:-inset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4";

/** "Lan Phạm" → "Lan": the chip's short name; a label without a person stays whole. */
const shortName = (s: SpeakerCount) => (s.participantId ? (s.name.split(/\s+/)[0] ?? s.name) : s.name);

/**
 * The transcript's find row (kit `.tx-find`): the search field with "2/7 ↑ ↓ ×"
 * (Enter next, Shift+Enter back), one chip per speaker with their line count
 * that keeps only their lines, and "Chỉ câu được trích".
 */
export function TranscriptFind({
  query,
  onQuery,
  hitCount,
  activeHit,
  onStep,
  speakers,
  speaker,
  onSpeaker,
  tintOf,
  citedOnly,
  onCitedOnly,
  hasCited,
  end,
}: {
  query: string;
  onQuery: (q: string) => void;
  hitCount: number;
  activeHit: number;
  onStep: (delta: 1 | -1) => void;
  speakers: readonly SpeakerCount[];
  speaker: string | null;
  onSpeaker: (name: string | null) => void;
  tintOf: (s: SpeakerCount) => Tint;
  citedOnly: boolean;
  onCitedOnly: (on: boolean) => void;
  hasCited: boolean;
  /**
   * The tab's ⋯. The board's find row and chapter bar carry none, so it sits at
   * the right end of the 44px tab row, 24 above the tab's `relative` section
   * (mt-6); a phone keeps it at the end of this row instead, where the tabs fill the width
   * (28 tall there, so a 44 touch button does not grow the row).
   */
  end?: ReactNode;
}) {
  const { t } = useTranslation();
  const searching = query.trim() !== "";
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (hitCount > 0) onStep(e.shiftKey ? -1 : 1);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="search" className="flex h-9 min-w-0 shrink grow-0 basis-66 items-center gap-0.5 rounded-control border border-input bg-background pr-1 pl-2.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring @max-[37.5rem]/meeting:basis-full @max-[37.5rem]/meeting:grow">
        <Search aria-hidden className="mr-1.5 size-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey}
          autoComplete="off"
          placeholder={t("meetings.transcriptSearchPlaceholder")}
          aria-label={t("meetings.transcriptSearchLabel")}
          className="h-full min-w-0 flex-1 bg-transparent text-body font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {searching ? (
          <>
            <span aria-live="polite" className="px-1.5 text-body font-medium whitespace-nowrap tabular-nums">
              <span className="sr-only">{t("meetings.detail.transcript.resultsPrefix")} </span>
              {`${hitCount === 0 ? 0 : activeHit + 1}/${hitCount}`}
            </span>
            <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
            <button
              type="button"
              className={ICON_BUTTON}
              disabled={hitCount === 0}
              aria-label={t("meetings.detail.transcript.prevHit")}
              aria-keyshortcuts="Shift+Enter"
              onClick={() => onStep(-1)}
            >
              <ArrowUp aria-hidden />
            </button>
            <button
              type="button"
              className={ICON_BUTTON}
              disabled={hitCount === 0}
              aria-label={t("meetings.detail.transcript.nextHit")}
              aria-keyshortcuts="Enter"
              onClick={() => onStep(1)}
            >
              <ArrowDown aria-hidden />
            </button>
            <button type="button" className={ICON_BUTTON} aria-label={t("meetings.detail.transcript.clearSearch")} onClick={() => onQuery("")}>
              <X aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      {speakers.length > 1 ? (
        <div role="group" aria-label={t("meetings.detail.transcript.speakerFilter")} className="flex flex-wrap items-center gap-1">
          {speakers.map((s) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={speaker === s.name}
              aria-label={t("meetings.detail.transcript.speakerOnly", { name: s.name, count: s.count })}
              onClick={() => onSpeaker(speaker === s.name ? null : s.name)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md pr-2 pl-1 text-caption font-medium text-foreground hover:bg-surface-hover aria-pressed:bg-surface-selected aria-pressed:text-brand-subtle-foreground pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2"
            >
              <MeetingPersonAvatar name={s.name} size={20} tint={tintOf(s)} />
              {shortName(s)}
              <span className="font-normal text-muted-foreground tabular-nums">{s.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      {hasCited ? (
        <label className={cn("ml-auto inline-flex min-h-7 cursor-pointer items-center gap-2 text-caption text-muted-foreground hover:text-foreground", "@max-[37.5rem]/meeting:ml-0")}>
          <Checkbox checked={citedOnly} onCheckedChange={(on) => onCitedOnly(on === true)} />
          {t("meetings.detail.transcript.citedOnly")}
        </label>
      ) : null}
      {end ? (
        <div className="absolute right-0 bottom-[calc(100%+1.5rem)] flex h-11 items-center @max-[37.5rem]/meeting:static @max-[37.5rem]/meeting:ml-auto @max-[37.5rem]/meeting:h-7">
          {end}
        </div>
      ) : null}
    </div>
  );
}
