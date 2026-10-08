/* global URL */
// Response headers for /office-frame/** (UNI-1013), derived from the checked-in
// pin so next.config.mjs never needs the bundle itself. Build-time only.
import { readFileSync } from "node:fs";
import { enforceFrameAncestors, parsePin, CSP_HEADER, FRAME_URL_ROOT } from "./frame-bundle.mjs";

export const PIN_PATH = new URL("./docs.pin.json", import.meta.url);

// What a path that has no pin is served with: nothing may run in it and only
// this origin may embed it. There is no bundle to serve in that state anyway.
const LOCKED_DOWN_CSP = "default-src 'none'; frame-ancestors 'self'";

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";

/**
 * @param {URL} [path]
 * @returns {import("./frame-bundle.mjs").FramePin | null}
 */
export function readPin(path = PIN_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
  return parsePin(JSON.parse(text));
}

/**
 * Next.js `headers()` rules. The security headers ride on every path under
 * /office-frame; caching is split so the two rules never overlap: files named
 * by a content hash live below a directory (assets/…) and are immutable for a
 * year, the top-level files of a version (index.html, manifest.json, csp.json)
 * are revalidated every time.
 * @param {import("./frame-bundle.mjs").FramePin | null} pin
 */
export function officeFrameHeaderRules(pin) {
  const csp = enforceFrameAncestors(pin?.headers[CSP_HEADER] ?? LOCKED_DOWN_CSP);
  const owned = new Set([CSP_HEADER, "x-frame-options", "x-content-type-options", "referrer-policy", "cache-control"].map((n) => n.toLowerCase()));
  const extra = Object.entries(pin?.headers ?? {}).filter(([name]) => !owned.has(name.toLowerCase()));
  const security = [
    { key: CSP_HEADER, value: csp },
    ...extra.map(([key, value]) => ({ key, value })),
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
  ];
  return [
    { source: "/office-frame/:path*", headers: security },
    { source: `${FRAME_URL_ROOT}/:version/:file`, headers: [{ key: "Cache-Control", value: REVALIDATE }] },
    { source: `${FRAME_URL_ROOT}/:version/:dir/:rest+`, headers: [{ key: "Cache-Control", value: IMMUTABLE }] },
  ];
}
