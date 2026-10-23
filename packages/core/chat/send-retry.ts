// When a chat send is worth repeating, shared by the web and the phone
// (apps/chat-mobile, ADR 0011: on its core allowlist, so it imports no
// transport). Each host throws its own ApiError (api/http.ts here,
// data/api.ts there); both are an Error with a numeric `status` and an
// optional `retryAfterSeconds`, and that structural slice is all the policy
// reads. Status 0 is the phone's own timeout or an unreachable server; the
// web's transport never answers it.

export const CHAT_SEND_MAX_ATTEMPTS = 3;
export const CHAT_SEND_RETRY_DELAYS_MS = [400, 1_200] as const;
/** A Retry-After longer than this is handed back: the sender should not watch a spinner. */
const CHAT_SEND_MAX_RETRY_AFTER_MS = 5_000;

/** The slice of an ApiError the policy reads. */
interface StatusError {
  status: number;
  retryAfterSeconds?: number;
}

/** An Error that carries an HTTP status: either host's ApiError, without importing a transport. */
function statusErrorOf(err: unknown): StatusError | null {
  if (!(err instanceof Error) || !("status" in err) || typeof err.status !== "number") return null;
  const retryAfter = "retryAfterSeconds" in err ? err.retryAfterSeconds : undefined;
  return typeof retryAfter === "number" ? { status: err.status, retryAfterSeconds: retryAfter } : { status: err.status };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** True when repeating the same client_msg_id send may succeed later. */
export function isRetriableChatSendError(err: unknown): boolean {
  // fetch rejects with a TypeError when there is no network at all.
  if (err instanceof TypeError) return true;
  const status = statusErrorOf(err)?.status;
  if (status === undefined) return false;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * True when the server refused this message for good (403 removed from the room,
 * 404 room gone, 410 deleted, 422 invalid). 401 is the session, not the message.
 */
export function isPermanentChatSendRefusal(err: unknown): boolean {
  const status = statusErrorOf(err)?.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 401 && !isRetriableChatSendError(err);
}

/**
 * The request never reached the server (fetch rejects with a TypeError). Only
 * this kind waits quietly for the next reconnect; any other answer that is not
 * a permanent refusal leaves the message failed, with "Thử lại", because with
 * the network up no reconnect will come to retry it.
 */
export function isChatSendNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

/** The server refused for rate, not reachability: say so, never "saved for when online". */
export function isChatSendRateLimited(err: unknown): boolean {
  return statusErrorOf(err)?.status === 429;
}

function retryAfterMs(err: unknown): number {
  return (statusErrorOf(err)?.retryAfterSeconds ?? 0) * 1_000;
}

export async function runWithChatSendRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    delaysMs?: readonly number[];
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? CHAT_SEND_MAX_ATTEMPTS;
  const delaysMs = options?.delaysMs ?? CHAT_SEND_RETRY_DELAYS_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const hasRetryLeft = attempt < maxAttempts - 1;
      const serverWait = retryAfterMs(err);
      if (!hasRetryLeft || !isRetriableChatSendError(err) || serverWait > CHAT_SEND_MAX_RETRY_AFTER_MS) {
        throw err;
      }
      const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? delaysMs.at(-1) ?? 400;
      await sleep(Math.max(delay, serverWait));
    }
  }

  throw lastError;
}
