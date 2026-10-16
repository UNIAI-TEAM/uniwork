import {
  buildOfficeDeepLink,
  officeClientId,
  safeOfficeDeepLink,
  type OfficeLaunchOptions,
  type OfficeLaunchOutcome,
} from "@uniwork/core/office";

export { buildOfficeDeepLink, officeClientId, safeOfficeDeepLink };
export type { OfficeLaunchOutcome };

/** A cold start of the app (and Windows holding the browser in front) takes
 * longer than a second; this is how long a missing hand-off is believed. */
const LAUNCH_WAIT_MS = 2500;
/** How long after "not-installed" a late hand-off is still reported. */
const LATE_HANDOFF_WINDOW_MS = 60_000;

export interface DeepLinkLauncherOptions extends OfficeLaunchOptions {
  timeoutMs?: number;
  lateWindowMs?: number;
  signal?: AbortSignal;
  open?: (url: string) => void;
  isHidden?: () => boolean;
  /** Subscribes to "the page lost focus or visibility" and returns the
   * unsubscribe. Defaults to window blur, pagehide and visibilitychange. */
  onHandoffSignal?: (signal: () => void) => () => void;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** The browser's protocol prompt and the app taking focus both blur the page. */
function watchPageHandoff(signal: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onVisibility = () => { if (document.visibilityState === "hidden") signal(); };
  window.addEventListener("blur", signal);
  window.addEventListener("pagehide", signal);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("blur", signal);
    window.removeEventListener("pagehide", signal);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason ?? new DOMException("Aborted", "AbortError")); return; }
  const timer = globalThis.setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
});

/** Best-effort custom-scheme launch. Browsers do not expose a reliable
 * protocol-handler result. A page that lost focus or visibility while we
 * waited (the protocol prompt, or the app coming to the front) counts as
 * launched; a tab that noticed nothing is reported as not-installed so the UI
 * can offer Open again/Install. */
export async function launchOfficeDeepLink(url: string, options: DeepLinkLauncherOptions = {}): Promise<OfficeLaunchOutcome> {
  const open = options.open ?? ((value: string) => { window.location.assign(value); });
  const isHidden = options.isHidden ?? (() => document.visibilityState === "hidden" || document.hidden);
  const wait = options.wait ?? delay;
  let handedOff = false;
  let late: (() => void) | null = null;
  const stopWatching = (options.onHandoffSignal ?? watchPageHandoff)(() => { handedOff = true; late?.(); });
  let keepWatching = false;
  try {
    open(url);
    await wait(options.timeoutMs ?? LAUNCH_WAIT_MS, options.signal);
    if (handedOff || isHidden()) return "launched";
    const notify = options.onLateHandoff;
    if (notify) {
      // A cold start can outlast the wait, and on Windows the app may not take
      // the foreground at all: keep listening so a late hand-off is reported.
      const giveUp = globalThis.setTimeout(() => { late = null; stopWatching(); }, options.lateWindowMs ?? LATE_HANDOFF_WINDOW_MS);
      late = () => { late = null; globalThis.clearTimeout(giveUp); stopWatching(); notify(); };
      keepWatching = true;
    }
    return "not-installed";
  } catch (error) {
    if (options.signal?.aborted) return "error";
    return error instanceof Error && /expired|ticket/i.test(error.message) ? "expired" : "error";
  } finally {
    if (!keepWatching) stopWatching();
  }
}
