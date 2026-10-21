"use client";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useOlderTranscript } from "@uniwork/core/meetings";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { MeetingFeedLoadOlder } from "./meeting-feed-load-older";
import { transcriptSpeaker } from "./meeting-transcript-panel";
import { useWindowedList } from "./use-windowed-list";

// This close to the bottom still counts as reading the newest line.
const STICK_PX = 48;

/**
 * The room's live transcript: its own scroll area that follows new lines
 * while the reader is at the bottom, keeps their place when they scrolled up
 * or an older page lands above, reads earlier pages on request, and mounts
 * only the rows near the viewport once the meeting runs long.
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
  const list = useWindowedList(segments.length);
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  // What the reader saw before this render: which line led the list, and where they were.
  const seen = useRef<{ first?: string; height: number; top: number }>({ height: 0, top: 0 });
  const { scrollRef } = list;
  const setScroll = useCallback(
    (el: HTMLDivElement | null) => {
      scrollEl.current = el;
      scrollRef(el);
    },
    [scrollRef],
  );

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
      ref={setScroll}
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
      <ol
        style={list.windowed ? { paddingTop: list.window.padTop, paddingBottom: list.window.padBottom } : undefined}
      >
        {segments.slice(list.window.start, list.window.end).map((s, i) => (
          <li
            key={s.id}
            // Spacing inside the row, so the row measured is the row repeated.
            className="pb-2"
            ref={i === 0 ? list.measureRow : undefined}
            aria-setsize={list.windowed ? segments.length : undefined}
            aria-posinset={list.windowed ? list.window.start + i + 1 : undefined}
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
