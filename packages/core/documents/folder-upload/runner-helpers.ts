import { ApiError } from "../../api/http";
import type { buildUploadProbe } from "../chunked-upload/probe";
import type { RunFolderUploadOptions } from "./runner-types";
import { FolderUploadError, type FileTarget, type FolderUploadPlanBody } from "./transport";
import type { FolderUploadPlan } from "./types";

// Pure helpers of the folder-upload runner (runner.ts): timers, error
// classification, the plan body and the invalidation throttle.

export const RETRY_DELAYS_MS = [1_000, 3_000];
export const INVALIDATE_EVERY_MS = 2_000;
export const BUSY_WAIT_DEFAULT_S = 30;
/** A 429 on complete/status without Retry-After. */
const RATE_LIMIT_WAIT_DEFAULT_S = 1;

export function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

/** Strip the root segment: the wire paths are under the root, which is "". */
function underRoot(path: string): string {
  const slash = path.indexOf("/");
  return slash < 0 ? "" : path.slice(slash + 1);
}

export function fileKey(position: number): string {
  return `f-${String(position + 1).padStart(4, "0")}`;
}

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `fu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isExpired(target: FileTarget): boolean {
  const at = Date.parse(target.expires_at);
  return Number.isFinite(at) && at <= Date.now();
}

/** Network failures and 5xx are worth another attempt; nothing else is. */
export function isTransient(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof ApiError && err.status >= 500);
}

export function failureCode(err: unknown): string {
  if (err instanceof FolderUploadError) return err.code;
  if (err instanceof ApiError) return err.code && err.code !== "internal" ? err.code : `http_${err.status}`;
  if (err instanceof TypeError) return "network";
  if (err instanceof DOMException && err.name === "AbortError") return "aborted";
  return "unknown";
}

const CLIENT_RETRYABLE = new Set(["network", "target_expired", "missing_etag", "missing_part_url", "aborted"]);

/**
 * A client-side failure the server never decided on: the file is still
 * pending there, so `retryFailed()` can send it again.
 */
export function isRetryableCode(code: string): boolean {
  return CLIENT_RETRYABLE.has(code) || /^http_5\d\d$/.test(code);
}

/** 410 expired, or 409 canceled elsewhere: nothing more can happen in this batch. */
export function batchEnd(err: unknown): "expired" | "canceled" | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 410) return "expired";
  if (err.status === 409 && err.code === "folder_upload_canceled") return "canceled";
  return null;
}

/**
 * One server call with the PUT retry rule: a network error or 5xx is tried
 * again after 1 s and 3 s, a 429 waits Retry-After once. Anything else, and
 * an abort, rejects at once.
 */
export async function withRetry<T>(call: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let retries = 0;
  let waited429 = false;
  for (;;) {
    try {
      return await call();
    } catch (err) {
      if (signal.aborted) throw err;
      let delay: number;
      if (err instanceof ApiError && err.status === 429 && !waited429) {
        waited429 = true;
        delay = (err.retryAfterSeconds ?? RATE_LIMIT_WAIT_DEFAULT_S) * 1_000;
      } else if (isTransient(err) && retries < RETRY_DELAYS_MS.length) {
        delay = RETRY_DELAYS_MS[retries] as number;
        retries += 1;
      } else {
        throw err;
      }
      await sleep(delay, signal);
    }
  }
}

/** At most one call per window, the last request of a window deferred to its end. */
export function createInvalidator(cb: (() => void) | undefined) {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    last = Date.now();
    cb?.();
  };
  return {
    request() {
      if (!cb || timer) return;
      const wait = last + INVALIDATE_EVERY_MS - Date.now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    final() {
      if (timer) clearTimeout(timer);
      fire();
    },
  };
}

export function planBody(
  plan: FolderUploadPlan,
  opts: RunFolderUploadOptions,
  probes: Map<number, Awaited<ReturnType<typeof buildUploadProbe>>>,
): FolderUploadPlanBody {
  return {
    parent_id: opts.parentId,
    root_name: plan.rootName,
    share_with_workspace: opts.shareWithWorkspace,
    folders: plan.folders.filter((f) => f.includes("/")).map(underRoot),
    files: plan.files.map((f, i) => {
      const probe = probes.get(i);
      return {
        file_key: fileKey(i),
        path: underRoot(f.folderPath),
        filename: f.filename,
        size_bytes: f.size,
        ...(probe ? { probe } : {}),
      };
    }),
  };
}
