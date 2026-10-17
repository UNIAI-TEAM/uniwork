import type { DocumentLimits } from "../api/endpoints/config";
import { defaultStorage } from "../platform/storage";
import type { StorageAdapter } from "../types/storage";

export const LAG_BANNER_DISMISSED_PREFIX = "office.lagBanner.dismissed:";

export interface LagObserverLike {
  readonly supportedEntryTypes?: readonly string[];
}

/**
 * Whether the browser's `PerformanceObserver` supports `longtask` or `event`
 * entries. Safari lacks both, in which case the host falls back to the stored
 * document size threshold (`web_open[format].warn_bytes`) at open.
 */
export function supportsLagPerformanceObserver(
  observer: LagObserverLike | null | undefined = (
    globalThis as { PerformanceObserver?: LagObserverLike }
  ).PerformanceObserver,
): boolean {
  const supported = observer?.supportedEntryTypes;
  if (!Array.isArray(supported)) return false;
  return supported.includes("longtask") || supported.includes("event");
}

export function lagBannerDismissedKey(documentId: string): string {
  return `${LAG_BANNER_DISMISSED_PREFIX}${documentId}`;
}

export function isLagBannerDismissed(
  documentId: string,
  storage: Pick<StorageAdapter, "getItem"> = defaultStorage,
): boolean {
  if (!documentId) return false;
  try {
    return storage.getItem(lagBannerDismissedKey(documentId)) === "1";
  } catch {
    return false;
  }
}

export function dismissLagBanner(
  documentId: string,
  storage: Pick<StorageAdapter, "setItem"> = defaultStorage,
): void {
  if (!documentId) return;
  try {
    storage.setItem(lagBannerDismissedKey(documentId), "1");
  } catch {
    // Storage unavailable or full: the in-memory dismissal still hides the banner for this session.
  }
}

/**
 * Size fallback for browsers without a `longtask` / `event` `PerformanceObserver`:
 * shows the lag banner at open when `sizeBytes > web_open[format].warn_bytes`.
 * Where an observer exists, the host relies solely on `lag_detected` (no double banner).
 */
export function shouldShowSizeFallbackLagBanner(options: {
  format: string;
  sizeBytes: number | null | undefined;
  webOpen: DocumentLimits["web_open"];
  hasObserver: boolean;
}): boolean {
  const { format, sizeBytes, webOpen, hasObserver } = options;
  if (hasObserver) return false;
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return false;
  const entry = format in webOpen ? webOpen[format as keyof DocumentLimits["web_open"]] : undefined;
  const warnBytes = entry?.warn_bytes;
  return typeof warnBytes === "number" && Number.isFinite(warnBytes) && sizeBytes > warnBytes;
}
