import { detectDesktopPlatform, type DesktopPlatformGuess, type DesktopPlatformHints } from "@uniwork/core/office";

interface HighEntropyValues { architecture?: string; bitness?: string }
type BrowserUserAgentData = NonNullable<DesktopPlatformHints["userAgentData"]> & {
  getHighEntropyValues?: (keys: string[]) => Promise<HighEntropyValues>;
};

/** Nothing proven: callers show every variant instead of guessing. */
export const UNKNOWN_PLATFORM: DesktopPlatformGuess = { platform: null, confidence: "unsupported" };

/**
 * This browser's platform guess. Mac user agents are frozen as Intel, so only the
 * high-entropy architecture hint (Chromium) proves Apple Silicon; Safari and
 * Firefox answer "uncertain" and the page then shows both Mac variants.
 */
export async function readBrowserPlatformGuess(): Promise<DesktopPlatformGuess> {
  const data = (navigator as Navigator & { userAgentData?: BrowserUserAgentData }).userAgentData;
  let entropy: HighEntropyValues = {};
  try { entropy = await data?.getHighEntropyValues?.(["architecture", "bitness"]) ?? {}; } catch { /* A reduced UA stays an uncertain guess. */ }
  return detectDesktopPlatform({
    userAgent: navigator.userAgent,
    userAgentData: data ? { platform: data.platform, mobile: data.mobile, ...entropy } : undefined,
  });
}
