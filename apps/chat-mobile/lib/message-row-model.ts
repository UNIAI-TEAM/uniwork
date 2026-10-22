// What one message row of a conversation draws, worked out once per change of
// the timeline instead of inside every cell's render. A model that
// comes out the same as last time is the same object as last time, so the
// memoized cell (components/chat/message-cell.tsx) skips it: a new message
// re-renders the new row and the one whose run it continues, a typing frame or
// a presence change re-renders none.
import type { TimelineMessage, TimelineRow } from "./timeline-display";

export type Receipt = "sent" | "delivered" | "seen";

/** Beside someone else's bubble in a group: their face on the last bubble of a run, the face's width on the others. */
type AvatarSlot = "none" | "spacer" | "face";

interface QuoteModel {
  id: string;
  sender: string;
  text: string;
}

export interface MessageRowModel {
  key: string;
  message: TimelineMessage;
  own: boolean;
  compactTop: boolean;
  /** The next message continues this run: no tail on this bubble. */
  continued: boolean;
  senderName: string;
  /** Print the name in the bubble (a group's first bubble of a run). */
  showSender: boolean;
  quote: QuoteModel | null;
  receipt: Receipt | null;
  avatar: AvatarSlot;
  /** Photos sent back to back with this one, drawn as one album bubble (this message first). */
  album: readonly TimelineMessage[] | undefined;
  /** The thread's root, in a thread: ringed, with the "N trả lời" divider under it. */
  root: boolean;
  /** Replies the root's divider counts; 0 everywhere else. */
  threadReplies: number;
  highlighted: boolean;
  /** Thread replies are off in a thread itself. */
  showThread: boolean;
  /** A swipe quotes it in the composer: a server message outside a thread. */
  swipeToReply: boolean;
  taskIds: readonly string[] | undefined;
}

export interface MessageRowModelInput {
  /** In any order (lib/timeline-layout.ts lays them out newest first). */
  rows: readonly TimelineRow[];
  /** Every loaded message by id (lib/timeline-layout.ts › byId): what a quote is read from. */
  byId: ReadonlyMap<string, TimelineMessage>;
  userId: string;
  threadRootId?: string;
  isGroup: boolean;
  /** Message rows whose next message continues the run (lib/timeline-layout.ts › continued). */
  continued: ReadonlySet<string>;
  albums: { folded: ReadonlySet<string>; byFirstId: ReadonlyMap<string, readonly TimelineMessage[]> };
  senderName: (message: TimelineMessage) => string;
  /** The quoted message's preview line. */
  quoteText: (message: TimelineMessage) => string;
  /** Who a quote names when its message is not loaded ("Trả lời"). */
  unknownQuoteSender: string;
  receiptOf: (message: TimelineMessage, own: boolean) => Receipt | null;
  highlightedId: string | null | undefined;
  taskIdsByMessage: ReadonlyMap<string, readonly string[]>;
}

const sameList = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((item, index) => item === b[index]));

const sameQuote = (a: QuoteModel | null, b: QuoteModel | null): boolean =>
  a === b || (a !== null && b !== null && a.id === b.id && a.sender === b.sender && a.text === b.text);

/** Two models draw the same row. */
export function sameRowModel(a: MessageRowModel, b: MessageRowModel): boolean {
  return (
    a.key === b.key &&
    a.message === b.message &&
    a.own === b.own &&
    a.compactTop === b.compactTop &&
    a.continued === b.continued &&
    a.senderName === b.senderName &&
    a.showSender === b.showSender &&
    a.receipt === b.receipt &&
    a.avatar === b.avatar &&
    a.root === b.root &&
    a.threadReplies === b.threadReplies &&
    a.highlighted === b.highlighted &&
    a.showThread === b.showThread &&
    a.swipeToReply === b.swipeToReply &&
    sameQuote(a.quote, b.quote) &&
    sameList(a.album, b.album) &&
    sameList(a.taskIds, b.taskIds)
  );
}

/** The inputs a row's name and quote are read with: unchanged, an unchanged message keeps last time's. */
type Readers = Pick<MessageRowModelInput, "userId" | "threadRootId" | "isGroup" | "senderName" | "quoteText" | "unknownQuoteSender">;

interface Workings {
  readers: Readers;
  /** The loaded message each row's quote was read from (undefined: none, or not loaded). */
  quoted: ReadonlyMap<string, TimelineMessage | undefined>;
}

// What each map of models was built with, so the next build can tell which rows need no work at all.
const workings = new WeakMap<ReadonlyMap<string, MessageRowModel>, Workings>();

const sameReaders = (a: Readers, b: Readers): boolean =>
  a.userId === b.userId &&
  a.threadRootId === b.threadRootId &&
  a.isGroup === b.isGroup &&
  a.senderName === b.senderName &&
  a.quoteText === b.quoteText &&
  a.unknownQuoteSender === b.unknownQuoteSender;

/**
 * One model per message row that draws something (a photo folded into its
 * album draws nothing), keyed by row key. A model equal to the one `previous`
 * holds for its key is returned as that very object. Incremental (2,000 loaded
 * messages): a row whose message, quoted message and
 * readers (the name and preview functions, viewer, thread) are those of last
 * time keeps its name and quote without calling the readers, and is handed
 * back without building a new object when nothing else it draws moved.
 */
export function buildMessageRowModels(input: MessageRowModelInput, previous?: ReadonlyMap<string, MessageRowModel>): Map<string, MessageRowModel> {
  const { userId, threadRootId, isGroup } = input;
  const readers: Readers = {
    userId,
    threadRootId,
    isGroup,
    senderName: input.senderName,
    quoteText: input.quoteText,
    unknownQuoteSender: input.unknownQuoteSender,
  };
  const last = previous ? workings.get(previous) : undefined;
  const sameReadersAsLast = last !== undefined && sameReaders(last.readers, readers);
  const { byId } = input;
  const models = new Map<string, MessageRowModel>();
  const quotedByKey = new Map<string, TimelineMessage | undefined>();
  for (const row of input.rows) {
    if (row.type !== "message") continue;
    const { message } = row;
    if (input.albums.folded.has(message.id)) continue;
    const own = message.sender === userId;
    const root = message.id === threadRootId;
    const continued = input.continued.has(row.key);
    const quotedId = message.replyToEventId;
    const quoted = quotedId ? byId.get(quotedId) : undefined;
    quotedByKey.set(row.key, quoted);
    const before = previous?.get(row.key);
    // Same message, same quoted message, same readers: the name and the quote are last time's.
    const read = sameReadersAsLast && before?.message === message && last.quoted.get(row.key) === quoted ? before : undefined;
    const showSender = isGroup && !own && row.showAvatar;
    const receipt = input.receiptOf(message, own);
    const album = input.albums.byFirstId.get(message.id);
    const highlighted = message.id === input.highlightedId;
    const taskIds = input.taskIdsByMessage.get(message.id);
    if (
      read &&
      !root &&
      read.compactTop === row.compactTop &&
      read.continued === continued &&
      read.showSender === showSender &&
      read.receipt === receipt &&
      read.highlighted === highlighted &&
      sameList(read.album, album) &&
      sameList(read.taskIds, taskIds)
    ) {
      models.set(row.key, read);
      continue;
    }
    // In a thread every reply answers the root above it: no quote of the root on each one.
    const quote: QuoteModel | null = read
      ? read.quote
      : quotedId && quotedId !== threadRootId
        ? quoted
          ? { id: quoted.id, sender: input.senderName(quoted), text: input.quoteText(quoted) }
          : { id: quotedId, sender: input.unknownQuoteSender, text: "…" }
        : null;
    const next: MessageRowModel = {
      key: row.key,
      message,
      own,
      compactTop: row.compactTop,
      continued,
      senderName: read ? read.senderName : input.senderName(message),
      showSender,
      quote,
      receipt,
      avatar: isGroup && !own && !root ? (continued ? "spacer" : "face") : "none",
      album,
      root,
      // The server's count covers replies on pages not loaded yet; the loaded ones cover a count not refreshed yet.
      threadReplies: root ? Math.max(message.record?.reply_count ?? 0, byId.size - 1) : 0,
      highlighted,
      showThread: !threadRootId,
      swipeToReply: !threadRootId && Boolean(message.record),
      taskIds,
    };
    models.set(row.key, before && sameRowModel(before, next) ? before : next);
  }
  workings.set(models, { readers, quoted: quotedByKey });
  return models;
}
