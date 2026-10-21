// A conversation's timeline laid out for the screen in one pass (audit P2
// Perf: a reader scrolled back holds up to a thousand messages, and every
// frame, receipt or reaction lays them out again). What it builds is what the
// plain definitions build — buildTimelineRows (day separators, grouping),
// continuedRunKeys (bubbles the next one continues) and albumsOf (photo
// albums) — and timeline-layout.test.ts holds the two equal. The difference:
//   - one read of each message, not one pass per rule;
//   - a message's rows depend only on it and the message before it, so they
//     are kept per message (by object: an unchanged record keeps its
//     TimelineMessage, timeline-display.ts › toTimelineMessage) and reused
//     while that pair and the time zone are the same — a new message builds
//     its own rows only, and every other row is the very object of last time;
//   - whether a message is an album photo (a content-type lookup) is worked
//     out once per message;
//   - the rows come out newest first, the order of the inverted list
//     (components/chat/message-list.tsx), so nothing reverses them per change;
//   - the message index by id that the row models read quotes from is filled
//     in the same pass.
import { ALBUM_MAX, isAlbumPhoto, photosJoin } from "./album";
import { dayKeysEpoch, messageDayKey, messageGrouping, type TimelineMessage, type TimelineRow } from "./timeline-display";

type MessageRow = Extract<TimelineRow, { type: "message" }>;
type DayRow = Extract<TimelineRow, { type: "day" }>;

interface TimelineAlbums {
  /** The album each first photo opens: it and the photos sent with it, oldest first. */
  byFirstId: Map<string, TimelineMessage[]>;
  /** The photos an album swallows: no row of their own. */
  folded: Set<string>;
}

export interface TimelineLayout {
  /** Newest first: each message row, then the day separator above it when it opens a day. */
  rows: TimelineRow[];
  /** Message rows the next message continues (same sender, close in time): not the last of their run. */
  continued: Set<string>;
  albums: TimelineAlbums;
  /** Every loaded message by id: what a quote looks its message up in. */
  byId: Map<string, TimelineMessage>;
}

interface Unit {
  /** The message before, the pair these rows were worked out for. */
  prev: TimelineMessage | undefined;
  epoch: number;
  row: MessageRow;
  day: DayRow | null;
}

const units = new WeakMap<TimelineMessage, Unit>();
const NO_RUN: TimelineMessage[] = [];
const albumPhotos = new WeakMap<TimelineMessage, boolean>();

function unitOf(prev: TimelineMessage | undefined, message: TimelineMessage, epoch: number): Unit {
  const kept = units.get(message);
  if (kept && kept.prev === prev && kept.epoch === epoch) return kept;
  const dayKey = messageDayKey(message.ts);
  const opensDay = !prev || messageDayKey(prev.ts) !== dayKey;
  const unit: Unit = {
    prev,
    epoch,
    row: { type: "message", key: message.id, message, ...messageGrouping(prev ? [prev, message] : [message], prev ? 1 : 0) },
    day: opensDay ? { type: "day", key: `day:${dayKey}`, ts: message.ts } : null,
  };
  units.set(message, unit);
  return unit;
}

function albumPhoto(message: TimelineMessage): boolean {
  let photo = albumPhotos.get(message);
  if (photo === undefined) {
    photo = isAlbumPhoto(message);
    albumPhotos.set(message, photo);
  }
  return photo;
}

/** Lay out `messages` (oldest first). */
export function layoutTimeline(messages: readonly TimelineMessage[]): TimelineLayout {
  const epoch = dayKeysEpoch();
  const count = messages.length;
  const byId = new Map<string, TimelineMessage>();
  const continued = new Set<string>();
  const albums: TimelineAlbums = { byFirstId: new Map(), folded: new Set() };
  const laid: Unit[] = new Array<Unit>(count);
  let rowCount = 0;
  let prev: TimelineMessage | undefined;
  let prevPhoto = false;
  // The photos of the album being gathered, oldest first; NO_RUN (never pushed to) after a message that is no photo.
  let run: TimelineMessage[] = NO_RUN;
  const closeRun = () => {
    if (run.length < 2) return;
    albums.byFirstId.set((run[0] as TimelineMessage).id, run);
    for (let photo = 1; photo < run.length; photo += 1) albums.folded.add((run[photo] as TimelineMessage).id);
  };
  for (let index = 0; index < count; index += 1) {
    const message = messages[index] as TimelineMessage;
    const unit = unitOf(prev, message, epoch);
    laid[index] = unit;
    rowCount += unit.day ? 2 : 1;
    byId.set(message.id, message);
    if (prev && unit.row.compactTop) continued.add(prev.id);
    const photo = albumPhoto(message);
    if (prev && prevPhoto && photo && photosJoin(prev, message) && run.length < ALBUM_MAX) {
      run.push(message);
    } else {
      closeRun();
      run = photo ? [message] : NO_RUN;
    }
    prev = message;
    prevPhoto = photo;
  }
  closeRun();
  const rows = new Array<TimelineRow>(rowCount);
  let at = 0;
  for (let index = count - 1; index >= 0; index -= 1) {
    const unit = laid[index] as Unit;
    rows[at++] = unit.row;
    if (unit.day) rows[at++] = unit.day;
  }
  return { rows, continued, albums, byId };
}
