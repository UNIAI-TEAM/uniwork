import { ApiError } from "../api/http";

export const CHAT_SEND_MAX_ATTEMPTS = 3;
export const CHAT_SEND_RETRY_DELAYS_MS = [400, 1_200] as const;
/** A Retry-After longer than this is handed back: the sender should not watch a spinner. */
const CHAT_SEND_MAX_RETRY_AFTER_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** True when repeating the same client_msg_id send may succeed later. */
export function isRetriableChatSendError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (!(err instanceof ApiError)) return false;
  if (err.status === 408 || err.status === 429) return true;
  return err.status >= 500;
}

/** The server refused for rate, not reachability: say so, never "saved for when online". */
export function isChatSendRateLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

function retryAfterMs(err: unknown): number {
  if (!(err instanceof ApiError) || err.retryAfterSeconds === undefined) return 0;
  return err.retryAfterSeconds * 1_000;
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
