import { ApiError } from "../api/http";

export const CHAT_SEND_MAX_ATTEMPTS = 3;
export const CHAT_SEND_RETRY_DELAYS_MS = [400, 1_200] as const;

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
      if (!hasRetryLeft || !isRetriableChatSendError(err)) {
        throw err;
      }
      const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? delaysMs.at(-1) ?? 400;
      await sleep(delay);
    }
  }

  throw lastError;
}
