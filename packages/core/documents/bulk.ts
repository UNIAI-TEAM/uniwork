import { ApiError } from "../api/http";
import { DocumentNotVerifiableError } from "../types/document";

// The batch runner behind the documents bulk bar (UNI-2045 W9, contract §7).
// There is no multi-id route for documents: a bulk command fans out over the
// single-document route, so permissions, audit and the outbox stay per
// document. One refusal never stops the batch, the global rate limit is
// respected by running at most four calls at once and retrying a 429 once.

/** One document the batch could not act on, with the reason class (`forbidden`, `not_found`, ... or the server's code). */
export interface BulkFailure {
  id: string;
  code: string;
}

/** The outcome of a batch, each list in the order the ids were given. */
export interface BulkResult {
  ok: string[];
  failed: BulkFailure[];
}

export interface BulkOptions {
  /** Calls in flight at once; capped at 4 whatever is asked. */
  concurrency?: number;
  /** Retries of a call the server answered 429. */
  retry429?: number;
  /** Waits out a 429 before the retry; a test seam. */
  wait?: (ms: number) => Promise<void>;
}

const MAX_CONCURRENCY = 4;
const DEFAULT_RETRY_WAIT_MS = 1000;
const MAX_RETRY_WAIT_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The reason class of one failed call: the refusal statuses get one name
 * each (a 403 and a 401 read the same to the person), any other ApiError
 * keeps its server code (`folder_too_large`, ...), an answer that cannot be
 * proven reads `not_verifiable` and anything else `failed`.
 */
export function bulkErrorCode(error: unknown): string {
  if (error instanceof DocumentNotVerifiableError) return "not_verifiable";
  if (!(error instanceof ApiError)) return "failed";
  switch (error.status) {
    case 401:
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return error.code && error.code !== "internal" ? error.code : "failed";
  }
}

/** Runs `fn` once per id, at most four at a time, and sorts the outcomes. It never throws. */
export async function runBulk(ids: readonly string[], fn: (id: string) => Promise<unknown>, opts: BulkOptions = {}): Promise<BulkResult> {
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, opts.concurrency ?? MAX_CONCURRENCY));
  const retries = Math.max(0, opts.retry429 ?? 1);
  const wait = opts.wait ?? sleep;
  const outcomes: (string | null)[] = new Array<string | null>(ids.length).fill(null);

  const attempt = async (id: string): Promise<string | null> => {
    for (let tries = 0; ; tries += 1) {
      try {
        await fn(id);
        return null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 429 && tries < retries) {
          const asked = error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : DEFAULT_RETRY_WAIT_MS;
          await wait(Math.min(asked, MAX_RETRY_WAIT_MS));
          continue;
        }
        return bulkErrorCode(error);
      }
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const index = next;
      next += 1;
      outcomes[index] = await attempt(ids[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));

  const result: BulkResult = { ok: [], failed: [] };
  ids.forEach((id, index) => {
    const code = outcomes[index];
    if (code === null || code === undefined) result.ok.push(id);
    else result.failed.push({ id, code });
  });
  return result;
}
