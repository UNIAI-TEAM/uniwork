"use client";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useOlderTranscript } from "@uniwork/core/meetings";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { MeetingFeedLoadOlder } from "./meeting-feed-load-older";
import { transcriptSpeaker } from "./meeting-transcript-panel";

// This close to the bottom still counts as reading the newest line.
const STICK_PX = 48;

/**
 * The room's live transcript: its own scroll area that follows new lines
 * while the reader is at the bottom, keeps their place when they scrolled up
 * or an older page lands above, and reads earlier pages on request. Lines of
 * any height stay mounted; the browser skips laying out the ones off screen.
 */
export function MeetingRoomTranscript({
  meetingId,
  segments,
  emptyText,
}: {
  meetingId: string;
  segments: readonly MeetingTranscriptSegment[];
  emptyText: string;
}) {
  const { t } = useTranslation();
  const older = useOlderTranscript(meetingId);
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  // What the reader saw before this render: which line led the list, and where they were.
  const seen = useRef<{ first?: string; height: number; top: number }>({ height: 0, top: 0 });

  useLayoutEffect(() => {
    const el = scrollEl.current;
    if (!el) return;
    const before = seen.current;
    const first = segments[0]?.id;
    if (before.first !== undefined && first !== before.first && before.height > 0) {
      // An older page came in above: the line the reader was on stays put.
      el.scrollTop = before.top + (el.scrollHeight - before.height);
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    seen.current = { first, height: el.scrollHeight, top: el.scrollTop };
  }, [segments]);

  const onScroll = () => {
    const el = scrollEl.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    seen.current = { ...seen.current, height: el.scrollHeight, top: el.scrollTop };
  };

  if (segments.length === 0 && !older.hasOlder) {
    return <p className="text-label text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div
      ref={scrollEl}
      onScroll={onScroll}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus so a keyboard can scroll it (axe scrollable-region-focusable)
      tabIndex={0}
      role="region"
      aria-label={t("meetings.transcriptTitle")}
      className="max-h-[min(28rem,60dvh)] overflow-y-auto rounded-lg"
      data-testid="meeting-room-transcript"
    >
      {older.hasOlder ? (
        <MeetingFeedLoadOlder
          label={t("meetings.transcriptLoadOlder")}
          loading={older.isLoadingOlder}
          onLoad={older.loadOlder}
        />
      ) : null}
      <ol>
        {segments.map((s) => (
          <li
            key={s.id}
            // Off screen a line is not laid out; it keeps its last real height (or about one line before it has one).
            className="pb-2 [content-visibility:auto] [contain-intrinsic-size:auto_3.25rem]"
          >
            <p className="rounded-lg bg-surface-hover px-2.5 py-2 text-body text-foreground">
              <span className="text-caption font-medium text-foreground">{transcriptSpeaker(s, t)}</span>
              <span className="text-muted-foreground"> · </span>
              {s.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
