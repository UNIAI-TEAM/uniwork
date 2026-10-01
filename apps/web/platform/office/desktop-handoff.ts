import {
  buildOfficeDeepLink,
  officeClientId,
  officeScheme,
  safeOfficeDeepLink,
  type OfficeChannel,
  type OfficeLaunchOutcome,
} from "@uniwork/core/office";

export { buildOfficeDeepLink, officeClientId, officeScheme, safeOfficeDeepLink };
export type { OfficeChannel, OfficeLaunchOutcome };

export interface DeepLinkLauncherOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  open?: (url: string) => void;
  isHidden?: () => boolean;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason ?? new DOMException("Aborted", "AbortError")); return; }
  const timer = globalThis.setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
});

/** Best-effort custom-scheme launch. Browsers do not expose a reliable
 * protocol-handler result, so a visible tab after the short timeout is
 * reported as not-installed and the UI can offer Open again/Install. */
export async function launchOfficeDeepLink(url: string, options: DeepLinkLauncherOptions = {}): Promise<OfficeLaunchOutcome> {
  const open = options.open ?? ((value: string) => { window.location.assign(value); });
  const isHidden = options.isHidden ?? (() => document.visibilityState === "hidden" || document.hidden);
  const wait = options.wait ?? delay;
  try {
    open(url);
    await wait(options.timeoutMs ?? 900, options.signal);
    return isHidden() ? "launched" : "not-installed";
  } catch (error) {
    if (options.signal?.aborted) return "error";
    return error instanceof Error && /expired|ticket/i.test(error.message) ? "expired" : "error";
  }
}
