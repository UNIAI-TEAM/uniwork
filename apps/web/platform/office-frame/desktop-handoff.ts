import {
  buildOfficeDeepLink,
  officeClientId,
  safeOfficeDeepLink,
  type OfficeLaunchOutcome,
} from "@uniwork/core/office";

export { buildOfficeDeepLink, officeClientId, safeOfficeDeepLink };
export type { OfficeLaunchOutcome };

export interface DeepLinkLauncherOptions {
  timeoutMs?: number;
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
  const stopWatching = (options.onHandoffSignal ?? watchPageHandoff)(() => { handedOff = true; });
  try {
    open(url);
    await wait(options.timeoutMs ?? 900, options.signal);
    return handedOff || isHidden() ? "launched" : "not-installed";
  } catch (error) {
    if (options.signal?.aborted) return "error";
    return error instanceof Error && /expired|ticket/i.test(error.message) ? "expired" : "error";
  } finally {
    stopWatching();
  }
}
