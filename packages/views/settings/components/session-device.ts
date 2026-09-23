/**
 * Turns a raw User-Agent string into the few words a person recognises
 * ("Chrome" on "macOS", a phone or a computer). Pure and table-driven: no
 * library, because the sessions list only needs a label, never a capability
 * check, and a wrong guess costs a less precise label, not a broken feature.
 */

type SessionPlatform = "desktop" | "mobile";

interface SessionDevice {
  /** Browser brand, or null when nothing matched. */
  browser: string | null;
  /** Operating system brand, or null when nothing matched. */
  os: string | null;
  platform: SessionPlatform;
}

// Order matters: Edge, Opera and Samsung also carry "Chrome/", and Chrome
// carries "Safari/", so the more specific tokens are tested first.
const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bcoc_coc_browser\//i, "Cốc Cốc"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/\b(?:iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

export function describeUserAgent(userAgent: string): SessionDevice {
  const ua = userAgent.trim();
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const os = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const mobile = /\bMobi/.test(ua) || /\b(?:iPhone|iPod|iPad|Android)\b/.test(ua);
  return { browser, os, platform: mobile ? "mobile" : "desktop" };
}

/** The address a session gets when the browser runs on the server's own machine. */
export function isLoopbackIp(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  return value === "::1" || value === "localhost" || /^127\./.test(value) || /^::ffff:127\./.test(value);
}
