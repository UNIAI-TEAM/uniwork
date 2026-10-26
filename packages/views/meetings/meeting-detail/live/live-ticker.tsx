"use client";
import { AudioLines, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { cn } from "@uniwork/ui/lib/utils";
import { transcriptSpeaker } from "../../transcript/transcript-speaker";
import { useDetail } from "../detail-context";
import { clock } from "../format";

/** A line older than this reads "Câu gần nhất" in muted ink instead of "Đang nói". */
const STALE_MS = 10 * 60_000;

/**
 * "Đang nói" (kit `.ticker`): the last transcript line on one truncated row;
 * the whole row opens the Lời thoại tab. The next line replaces it in place.
 */
export function LiveTicker({ line }: { line: MeetingTranscriptSegment | undefined }) {
  const { t } = useTranslation();
  const { now, tabs } = useDetail();
  if (!line) return null;
  const stale = now - Date.parse(line.spoken_at) > STALE_MS;
  const key = t(stale ? "meetings.detail.live.tickerLast" : "meetings.detail.live.tickerNow");
  const name = transcriptSpeaker(line, t);
  const time = clock(line.spoken_at);
  return (
    <button
      type="button"
      onClick={() => tabs.set("transcript")}
      aria-label={t("meetings.detail.live.tickerLabel", { key, name, time })}
      className="-mx-2 flex h-9 w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 text-left text-foreground hover:bg-surface-hover pointer-coarse:h-11 @max-[37.5rem]/meeting:h-11"
    >
      <span
        className={cn(
          "inline-flex flex-none items-center gap-1.5 text-caption font-medium",
          stale ? "text-muted-foreground" : "text-success",
        )}
      >
        <AudioLines aria-hidden className="size-3.5" />
        {key}
      </span>
      <span className="min-w-0 flex-1 truncate text-body">
        {name}
        {" · "}
        <time dateTime={line.spoken_at} className="font-mono text-caption font-medium text-muted-foreground">
          {time}
        </time>
        {" — "}
        {line.text}
      </span>
      <ChevronRight aria-hidden className="size-3.5 flex-none text-muted-foreground" />
    </button>
  );
}
