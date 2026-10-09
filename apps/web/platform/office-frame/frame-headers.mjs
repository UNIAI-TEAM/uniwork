// Response headers for /office-frame/** (UNI-1013; per module since UNI-1014),
// derived from the checked-in pins so next.config.mjs never needs the bundles
// themselves. Build-time only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertModule, enforceFrameAncestors, frameUrlRoot, parsePin, CSP_HEADER, OFFICE_MODULES } from "./frame-bundle.mjs";

const PIN_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * `<module>.pin.json` beside this file; docs.pin.json is the Docs pin of UNI-1013.
 * @param {string} module
 */
export function pinPath(module) {
  return join(PIN_DIR, `${assertModule(module)}.pin.json`);
}

// What a path that has no pin is served with: nothing may run in it and only
// this origin may embed it. There is no bundle to serve in that state anyway.
const LOCKED_DOWN_CSP = "default-src 'none'; frame-ancestors 'self'";

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";

/**
 * @param {string} [path]
 * @returns {import("./frame-bundle.mjs").FramePin | null}
 */
export function readPin(path = pinPath("docs")) {
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
 * Every module's pin (null where a module has none yet).
 * @returns {Record<string, import("./frame-bundle.mjs").FramePin | null>}
 */
export function readPins() {
  return Object.fromEntries(OFFICE_MODULES.map((module) => [module, readPin(pinPath(module))]));
}

/**
 * Next.js `headers()` rules. Every path under /office-frame first gets the
 * locked-down security headers; each module's own rule follows and, for paths
 * under /office-frame/<module>/, overrides them with that module's pinned
 * policy (Next applies every matching rule in order and the last value of a
 * header wins). Caching is split per module so the two rules never overlap:
 * files named by a content hash live below a directory (assets/…) and are
 * immutable for a year, the top-level files of a version (index.html,
 * manifest.json, csp.json) are revalidated every time.
 * @param {Record<string, import("./frame-bundle.mjs").FramePin | null>} pins
 */
export function officeFrameHeaderRules(pins) {
  return [
    { source: "/office-frame/:path*", headers: securityHeaders(null) },
    ...OFFICE_MODULES.flatMap((module) => {
      const root = frameUrlRoot(module);
      return [
        { source: `${root}/:path*`, headers: securityHeaders(pins[module] ?? null) },
        { source: `${root}/:version/:file`, headers: [{ key: "Cache-Control", value: REVALIDATE }] },
        { source: `${root}/:version/:dir/:rest+`, headers: [{ key: "Cache-Control", value: IMMUTABLE }] },
      ];
    }),
  ];
}

/**
 * The pinned CSP (or the locked-down one without a pin) plus the headers the
 * host owns, which a bundle's csp.json can never override.
 * @param {import("./frame-bundle.mjs").FramePin | null} pin
 */
function securityHeaders(pin) {
  const csp = enforceFrameAncestors(pin?.headers[CSP_HEADER] ?? LOCKED_DOWN_CSP);
  const owned = new Set([CSP_HEADER, "x-frame-options", "x-content-type-options", "referrer-policy", "cache-control"].map((n) => n.toLowerCase()));
  const extra = Object.entries(pin?.headers ?? {}).filter(([name]) => !owned.has(name.toLowerCase()));
  return [
    { key: CSP_HEADER, value: csp },
    ...extra.map(([key, value]) => ({ key, value })),
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
  ];
}
