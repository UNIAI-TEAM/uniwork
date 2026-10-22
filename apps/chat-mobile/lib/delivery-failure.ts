// Whose fault a failed delivery is, for the two queues that replay what the
// person did offline (data/chat-send.ts, data/pending-ops.ts). A failure the
// network or the session explains (fetch's TypeError, the phone's own timeout
// as status 0, an expired session, a rate limit) would fail every item of the
// line the same way: the line waits and nothing is counted against the item.
// Anything else the server answered about this one item (a 5xx it gives every
// time, a 408), or a throw that is no HTTP answer at all (a bug, a file that
// will not read), is counted against it: past a cap the item stops being
// retried, so one poison message or op can never hold the rest behind it for
// ever, as WhatsApp and Telegram cap a stuck message and offer "tap to retry".
import { isRecord } from "./unknown-shape";

export type FailureScope = "line" | "item";

function statusOf(error: unknown): number | undefined {
  const status = isRecord(error) ? error.status : undefined;
  return typeof status === "number" ? status : undefined;
}

/** "line" when the network or the session explains the failure; "item" when it is this item's own. */
export function failureScope(error: unknown): FailureScope {
  if (error instanceof TypeError) return "line";
  const status = statusOf(error);
  return status === 0 || status === 401 || status === 429 ? "line" : "item";
}

/**
 * A message in a room's line is tried this many rounds (each round is the
 * shared send policy's three tries, the line's 2/5/15/60 s backoff between
 * rounds: about two minutes) before it shows as failed with "Thử lại" and the
 * room's next messages go.
 */
export const MAX_SEND_ITEM_FAILURES = 5;

/**
 * A queued read, reaction, vote, edit or delete is set aside after each of
 * its own failures (the others go on meanwhile) for these waits, then given
 * up: the room goes back to the server's state. About two and a half hours in
 * all, so an outage of the API outlives no wish shorter than that.
 */
export const OP_ITEM_RETRY_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000] as const;
export const MAX_OP_ITEM_FAILURES = OP_ITEM_RETRY_MS.length + 1;

/** The wait after an op's `failures`-th failure of its own (1 is the first), spread ±20 %. */
export function opItemRetryDelay(failures: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(failures, 1), OP_ITEM_RETRY_MS.length) - 1;
  return Math.round(OP_ITEM_RETRY_MS[index]! * (0.8 + 0.4 * random()));
}
