// What one message row of a conversation draws, worked out once per change of
// the timeline instead of inside every cell's render (audit H1). A model that
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
  rows: readonly TimelineRow[];
  messages: readonly TimelineMessage[];
  userId: string;
  threadRootId?: string;
  isGroup: boolean;
  /** Message rows whose next row continues the run (lib/conversation-display.ts › continuedRunKeys). */
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

const sameList = <T,>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean =>
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

/**
 * One model per message row that draws something (a photo folded into its
 * album draws nothing), keyed by row key. A model equal to the one `previous`
 * holds for its key is returned as that very object.
 */
export function buildMessageRowModels(input: MessageRowModelInput, previous?: ReadonlyMap<string, MessageRowModel>): Map<string, MessageRowModel> {
  const { userId, threadRootId, isGroup } = input;
  const byId = new Map(input.messages.map((message) => [message.id, message]));
  const models = new Map<string, MessageRowModel>();
  for (const row of input.rows) {
    if (row.type !== "message") continue;
    const { message } = row;
    if (input.albums.folded.has(message.id)) continue;
    const own = message.sender === userId;
    const root = message.id === threadRootId;
    const continued = input.continued.has(row.key);
    const quotedId = message.replyToEventId;
    const quoted = quotedId ? byId.get(quotedId) : undefined;
    // In a thread every reply answers the root above it: no quote of the root on each one.
    const quote: QuoteModel | null =
      quotedId && quotedId !== threadRootId
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
      senderName: input.senderName(message),
      showSender: isGroup && !own && row.showAvatar,
      quote,
      receipt: input.receiptOf(message, own),
      avatar: isGroup && !own && !root ? (continued ? "spacer" : "face") : "none",
      album: input.albums.byFirstId.get(message.id),
      root,
      // The server's count covers replies on pages not loaded yet; the loaded ones cover a count not refreshed yet.
      threadReplies: root ? Math.max(message.record?.reply_count ?? 0, input.messages.length - 1) : 0,
      highlighted: message.id === input.highlightedId,
      showThread: !threadRootId,
      swipeToReply: !threadRootId && Boolean(message.record),
      taskIds: input.taskIdsByMessage.get(message.id),
    };
    const before = previous?.get(row.key);
    models.set(row.key, before && sameRowModel(before, next) ? before : next);
  }
  return models;
}
