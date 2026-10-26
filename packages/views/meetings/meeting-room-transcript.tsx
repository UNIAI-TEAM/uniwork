"use client";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, Check, Search, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { identityTint } from "@uniwork/core/chat/identity-tint";
import { useOlderTranscript } from "@uniwork/core/meetings";
import type { SegmentLink } from "@uniwork/core/meetings/feed";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@uniwork/ui/components/ui/input-group";
import { cn } from "@uniwork/ui/lib/utils";
import { formatMessageTime } from "../chat/chat-message-time";
import { senderNameClass } from "../chat/sender-colors";
import { meetingLocale } from "./meeting-datetime";
import { MeetingFeedLoadOlder } from "./meeting-feed-load-older";
import { MeetingPersonAvatar } from "./meeting-person";
import { useRoomAvatarOf } from "./meeting-room-avatars";
import { PARTICIPANT_IDENTITY_PREFIX } from "./meeting-signals";
import { TOUCH_TARGET } from "./touch-target";
import { transcriptSpeaker } from "./transcript/transcript-speaker";
import { useNow } from "./use-now";

// This close to the bottom still counts as reading the newest line.
const STICK_PX = 48;
// A group whose newest line is younger than this is someone speaking now.
const LIVE_MS = 10_000;
// How long a line the reader jumped to stays marked.
const FLASH_MS = 2_000;

type Range = readonly [start: number, end: number];
type Line = { segment: MeetingTranscriptSegment; matches: readonly Range[] };
type Group = { key: string; identity: string | null; name: string; lines: Line[] };

/** Lower-case without tone marks, so "thanh toan" finds "thanh toán" and "dong" finds "Đồng". */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");

/** Where `query` (already folded) occurs in `text`, as ranges of the original string. */
function matchRanges(text: string, query: string): Range[] {
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    // A lone combining mark folds to nothing: it belongs to the letter before it.
    if (f.length === 0 && to.length > 0) to[to.length - 1] = i + ch.length;
    for (let k = 0; k < f.length; k += 1) {
      from.push(i);
      to.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  const out: Range[] = [];
  for (let at = folded.indexOf(query); at !== -1; at = folded.indexOf(query, at + query.length)) {
    out.push([from[at]!, to[at + query.length - 1]!]);
  }
  return out;
}

function highlighted(text: string, ranges: readonly Range[]): ReactNode {
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const [a, b] of ranges) {
    parts.push(text.slice(last, a));
    parts.push(
      <mark key={a} className="rounded-sm bg-warning-soft text-foreground">
        {text.slice(a, b)}
      </mark>,
    );
    last = b;
  }
  parts.push(text.slice(last));
  return parts;
}

/**
 * The room's live transcript: one scroll area of speaker groups that follows
 * new lines while the reader is at the bottom, keeps their place when they
 * scrolled up (offering a jump back once something new arrives) or an older
 * page lands above, and reads earlier pages on request. Groups of any height
 * stay mounted; the browser skips laying out the ones off screen.
 */
export function MeetingRoomTranscript({
  meetingId,
  segments,
  links,
  emptyText,
  focusSegmentId,
  searchOpen = false,
  onOpenLink,
}: {
  meetingId: string;
  segments: readonly MeetingTranscriptSegment[];
  /** What each line became (`transcriptLinks`): a chip under the line. */
  links?: ReadonlyMap<string, readonly SegmentLink[]>;
  emptyText: string;
  /** A line to scroll to and mark for a moment, e.g. from the feed's time. */
  focusSegmentId?: string | null;
  searchOpen?: boolean;
  /** Takes the reader to the feed filtered to that kind; without it the chips are plain labels. */
  onOpenLink?: (kind: SegmentLink["kind"]) => void;
}) {
  const { t } = useTranslation();
  const older = useOlderTranscript(meetingId);
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const searchEl = useRef<HTMLInputElement | null>(null);
  const atBottom = useRef(true);
  // What the reader saw before this render: which line led the list, and where they were.
  const seen = useRef<{ first?: string; height: number; top: number }>({ height: 0, top: 0 });
  const [following, setFollowing] = useState(true);
  // The newest line when the reader left the bottom: anything after it is unread.
  const [seenLast, setSeenLast] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const lastId = segments.at(-1)?.id;

  useEffect(() => {
    if (searchOpen) searchEl.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!focusSegmentId) return;
    const nodes = scrollEl.current?.querySelectorAll<HTMLElement>("[data-segment-id]") ?? [];
    const target = Array.from(nodes).find((n) => n.dataset.segmentId === focusSegmentId);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    setFlash(focusSegmentId);
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    // A new focus, or none, within the two seconds must not leave the old line marked.
    return () => {
      clearTimeout(timer);
      setFlash(null);
    };
  }, [focusSegmentId]);

  const folded = searchOpen ? fold(query.trim()) : "";
  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const segment of segments) {
      if (folded && !fold(segment.text).includes(folded)) continue;
      const matches = folded ? matchRanges(segment.text, folded) : [];
      // A room-mic line (it carries a label) is not its device's person: no face, no colour.
      const identity = segment.participant_id && !segment.speaker_label ? PARTICIPANT_IDENTITY_PREFIX + segment.participant_id : null;
      const name = transcriptSpeaker(segment, t);
      const key = `${identity ?? ""}\u0000${name}`;
      const prev = out.at(-1);
      if (prev?.key === key) prev.lines.push({ segment, matches });
      else out.push({ key, identity, name, lines: [{ segment, matches }] });
    }
    return out;
  }, [segments, folded, t]);

  // Runs on the rendered groups, not only the lines: a search changes the height too, and a
  // stale height would throw the next older page's correction off. The first-line check
  // keeps a search change from counting as a page landing above.
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
  }, [segments, groups]);

  const onScroll = () => {
    const el = scrollEl.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (!bottom && atBottom.current) setSeenLast(lastId);
    atBottom.current = bottom;
    setFollowing(bottom);
    seen.current = { ...seen.current, height: el.scrollHeight, top: el.scrollTop };
  };

  const jumpToLatest = () => {
    const el = scrollEl.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setFollowing(true);
    // The pill unmounts with this click; keep keyboard focus in the transcript.
    el.focus({ preventScroll: true });
  };

  if (segments.length === 0 && !older.hasOlder) {
    return <p className="text-label text-muted-foreground">{emptyText}</p>;
  }

  const lastGroup = groups.at(-1);
  const lastVisibleId = lastGroup?.lines.at(-1)?.segment.id;
  // Unread: a line the search shows arrived after the newest one when the reader left the bottom.
  const unread =
    !following &&
    lastVisibleId !== undefined &&
    segments.findIndex((x) => x.id === lastVisibleId) > segments.findIndex((x) => x.id === seenLast);
  const liveAt = lastGroup?.lines.at(-1)?.segment.id === lastId ? lastGroup?.lines.at(-1)?.segment.spoken_at : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {searchOpen ? (
        <InputGroup className="mb-2 h-9 shrink-0 rounded-xl bg-surface-hover">
          <InputGroupAddon align="inline-start">
            <Search aria-hidden className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchEl}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("meetings.panel.transcript.search")}
            aria-label={t("meetings.panel.transcript.search")}
            className="bg-transparent"
          />
        </InputGroup>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollEl}
          onScroll={onScroll}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus so a keyboard can scroll it (axe scrollable-region-focusable)
          tabIndex={0}
          role="region"
          aria-label={t("meetings.transcriptTitle")}
          className="min-h-0 flex-1 overflow-y-auto rounded-lg"
          data-testid="meeting-room-transcript"
        >
          {older.hasOlder ? (
            <MeetingFeedLoadOlder
              label={t("meetings.transcriptLoadOlder")}
              loading={older.isLoadingOlder}
              onLoad={older.loadOlder}
            />
          ) : null}
          <ol className="flex flex-col gap-4 px-0.5 pt-1 pb-3">
            {groups.map((group) =>
              group === lastGroup && liveAt ? (
                <LiveSpeakerGroup key={group.lines[0]!.segment.id} group={group} spokenAt={liveAt} links={links} flash={flash} onOpenLink={onOpenLink} />
              ) : (
                <SpeakerGroup key={group.lines[0]!.segment.id} group={group} links={links} flash={flash} onOpenLink={onOpenLink} />
              ),
            )}
          </ol>
        </div>
        {unread ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-surface shadow-md"
            onClick={jumpToLatest}
          >
            <ArrowDown aria-hidden data-icon="inline-start" className="size-4" />
            {t("meetings.panel.transcript.latest")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type GroupProps = {
  group: Group;
  links: ReadonlyMap<string, readonly SegmentLink[]> | undefined;
  flash: string | null;
  onOpenLink: ((kind: SegmentLink["kind"]) => void) | undefined;
};

/** The newest group: it alone watches the clock, to show its speaker as speaking for ten seconds. */
function LiveSpeakerGroup({ spokenAt, ...props }: GroupProps & { spokenAt: string }) {
  const now = useNow(1_000);
  const age = now - Date.parse(spokenAt);
  return <SpeakerGroup {...props} speaking={age < LIVE_MS} />;
}

const SpeakerGroup = memo(function SpeakerGroup({ group, links, flash, onOpenLink, speaking = false }: GroupProps & { speaking?: boolean }) {
  const { t, i18n } = useTranslation();
  const avatarOf = useRoomAvatarOf();
  const { identity, name, lines } = group;
  const ms = Date.parse(lines[0]!.segment.spoken_at);
  const time = Number.isFinite(ms) ? formatMessageTime(ms, meetingLocale(i18n.language)) : null;
  return (
    // Off screen a group is not laid out; it keeps its last real height (or about two lines before it has one).
    <li className="flex gap-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_4.5rem]">
      <span
        className={cn(
          "inline-flex shrink-0 self-start rounded-full",
          speaking && "ring-2 ring-success/50 ring-offset-2 ring-offset-surface",
        )}
      >
        <MeetingPersonAvatar
          name={name}
          avatarUrl={identity ? avatarOf(identity) : undefined}
          tint={identity ? identityTint(identity) : undefined}
          size={28}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-label font-semibold", identity ? senderNameClass(identity, false) : "text-foreground")}>
            {name}
          </span>
          {speaking ? (
            <span role="img" aria-label={t("meetings.panel.transcript.speaking")} className="inline-flex h-3 items-end gap-0.5">
              <span className="h-1.5 w-0.5 rounded-[1px] bg-success" />
              <span className="h-3 w-0.5 rounded-[1px] bg-success" />
              <span className="h-2 w-0.5 rounded-[1px] bg-success" />
            </span>
          ) : time ? (
            <span className="text-caption text-faint-foreground tabular-nums">{time}</span>
          ) : null}
        </div>
        {lines.map(({ segment, matches }) => {
          const chips = links?.get(segment.id) ?? [];
          return (
            <div key={segment.id}>
              <p
                data-segment-id={segment.id}
                className={cn(
                  "mt-0.5 rounded-md text-body leading-[21px] text-pretty text-foreground transition-colors duration-500",
                  flash === segment.id && "bg-brand-subtle",
                )}
              >
                {highlighted(segment.text, matches)}
              </p>
              {chips.length > 0 ? (
                <div className="mt-1.5 mb-1 flex flex-wrap gap-1.5">
                  {chips.map((link, i) => (
                    <LinkChip key={i} link={link} onOpenLink={onOpenLink} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </li>
  );
});

/** What a line became: a decision (success) or a new item and its owner (brand). */
function LinkChip({ link, onOpenLink }: { link: SegmentLink; onOpenLink: GroupProps["onOpenLink"] }) {
  const { t } = useTranslation();
  const decision = link.kind === "decision";
  const label = decision
    ? t("meetings.panel.transcript.becameDecision")
    : link.owner
      ? t("meetings.panel.transcript.newItemOwner", { owner: link.owner })
      : t("meetings.panel.transcript.newItem");
  const Icon = decision ? Check : Square;
  const className = cn(
    "inline-flex h-6 items-center gap-1.25 rounded-full ps-1 pe-2 text-caption font-medium",
    decision ? "bg-success-soft text-success" : "bg-brand-subtle text-brand",
  );
  const body = (
    <>
      <span className="flex size-4 items-center justify-center rounded-full bg-surface">
        <Icon aria-hidden className="size-3" />
      </span>
      {label}
    </>
  );
  return onOpenLink ? (
    <button type="button" className={cn(className, TOUCH_TARGET, "hover:underline")} onClick={() => onOpenLink(link.kind)}>
      {body}
    </button>
  ) : (
    <span className={className}>{body}</span>
  );
}
