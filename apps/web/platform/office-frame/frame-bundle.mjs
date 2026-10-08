// The Docs web frame bundle (UNI-1013): what the fork's versioned web build
// looks like on disk (manifest.json + csp.json) and how it is verified before
// it is served from /office-frame/docs/<version>/.
//
// Pure functions only; the CLI that touches the network and `public/` is
// apps/web/scripts/office-frame-sync.mjs. Node-only, never imported by browser
// code (next.config.mjs and the sync script read it at build time).
import { createHash } from "node:crypto";

export const FRAME_URL_ROOT = "/office-frame/docs";
export const CSP_HEADER = "Content-Security-Policy";

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_SHA_RE = /^[0-9a-f]{7,64}$/;

/** @param {Uint8Array | string} data */
export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * The version names a directory and a URL segment, so it is held to one safe
 * alphabet: no slash, no dot-only segment, nothing a path join could escape.
 * @param {unknown} version
 * @returns {string}
 */
export function assertSafeVersion(version) {
  if (typeof version !== "string" || !VERSION_RE.test(version) || /^\.+$/.test(version)) {
    throw new Error(`frame bundle version ${JSON.stringify(version)} is not a safe path segment`);
  }
  return version;
}

/**
 * A manifest path is relative, forward-slashed and stays inside the bundle.
 * @param {unknown} path
 * @returns {string}
 */
export function assertSafeBundlePath(path) {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`frame bundle path ${JSON.stringify(path)} is not a relative bundle path`);
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`frame bundle path ${JSON.stringify(path)} escapes the bundle`);
    }
  }
  return path;
}

/**
 * @typedef {{ path: string, bytes: number, sha256: string }} ManifestFile
 * @typedef {{ version: string, gitSha: string, entry: string, dirty: boolean, files: ManifestFile[] }} FrameManifest
 */

/**
 * Validates the fork's manifest.json ({version, gitSha, entry, files[]}); any
 * other field (builtAt, totalBytes, gzipBytes) is informational and ignored.
 * @param {unknown} raw
 * @returns {FrameManifest}
 */
export function parseManifest(raw) {
  if (!raw || typeof raw !== "object") throw new Error("manifest.json is not an object");
  const m = /** @type {Record<string, unknown>} */ (raw);
  const version = assertSafeVersion(m.version);
  if (typeof m.gitSha !== "string" || !GIT_SHA_RE.test(m.gitSha)) throw new Error("manifest.gitSha is not a git SHA");
  const entry = assertSafeBundlePath(m.entry);
  if (!Array.isArray(m.files) || m.files.length === 0) throw new Error("manifest.files is empty");
  /** @type {Set<string>} */
  const seen = new Set();
  const files = m.files.map((row) => {
    const f = /** @type {Record<string, unknown>} */ (row && typeof row === "object" ? row : {});
    const path = assertSafeBundlePath(f.path);
    if (seen.has(path)) throw new Error(`manifest lists ${path} twice`);
    seen.add(path);
    if (typeof f.sha256 !== "string" || !SHA256_RE.test(f.sha256)) throw new Error(`manifest sha256 for ${path} is not a hex digest`);
    if (typeof f.bytes !== "number" || !Number.isSafeInteger(f.bytes) || f.bytes < 0) throw new Error(`manifest bytes for ${path} is not a size`);
    return { path, bytes: f.bytes, sha256: f.sha256 };
  });
  if (!seen.has(entry)) throw new Error(`manifest entry ${entry} is not in files`);
  return { version, gitSha: m.gitSha, entry, dirty: m.dirty === true, files };
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function ancestorSources(value) {
  const match = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(value);
  return match ? (match[1] ?? "").trim().split(/\s+/).filter(Boolean) : [];
}

/**
 * The frame may be embedded by this origin only (same-origin iframe today; the
 * subdomain move is a deliberate future change, not something a bundle may
 * widen on its own). A policy without frame-ancestors gets `'self'`; one that
 * names anything else is refused.
 * @param {string} policy
 * @returns {string}
 */
export function enforceFrameAncestors(policy) {
  const value = policy.trim().replace(/;+\s*$/, "");
  if (!value) throw new Error("Content-Security-Policy is empty");
  if (!/(?:^|;)\s*frame-ancestors\b/i.test(value)) return `${value}; frame-ancestors 'self'`;
  const sources = ancestorSources(value);
  if (sources.length !== 1 || sources[0] !== "'self'") {
    throw new Error(`csp.json frame-ancestors must be exactly 'self', got ${JSON.stringify(sources.join(" "))}`);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} directives
 * @returns {string}
 */
function policyFromDirectives(directives) {
  return Object.entries(directives)
    .map(([name, sources]) => {
      const list = Array.isArray(sources) ? sources.join(" ") : String(sources ?? "");
      return `${name} ${list}`.trim();
    })
    .join("; ");
}

/**
 * Reads the fork's csp.json into the response headers the frame needs. Accepted
 * shapes: `{ directives: { name: string | string[] } }`, `{ policy: string }`,
 * `{ headers: { Name: value } | [{ name|key, value }] }`, `{ header, value }`
 * (what the fork's build emits), or a bare `{ "Content-Security-Policy": "..." }`. The result always carries a
 * Content-Security-Policy whose frame-ancestors is 'self'.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function parseCspManifest(raw) {
  if (!raw || typeof raw !== "object") throw new Error("csp.json is not an object");
  const c = /** @type {Record<string, unknown>} */ (raw);
  /** @type {Record<string, string>} */
  const headers = {};
  if (Array.isArray(c.headers)) {
    for (const row of c.headers) {
      const r = /** @type {Record<string, unknown>} */ (row && typeof row === "object" ? row : {});
      const name = r.name ?? r.key;
      if (typeof name === "string" && typeof r.value === "string") headers[name] = r.value;
    }
  } else if (c.headers && typeof c.headers === "object") {
    for (const [name, value] of Object.entries(c.headers)) if (typeof value === "string") headers[name] = value;
  } else {
    for (const [name, value] of Object.entries(c)) if (typeof value === "string" && /^[A-Za-z][A-Za-z0-9-]*$/.test(name) && name.includes("-")) headers[name] = value;
  }
  if (typeof c.header === "string" && typeof c.value === "string") headers[c.header] = c.value;
  const hasPolicy = Object.keys(headers).some((name) => name.toLowerCase() === CSP_HEADER.toLowerCase());
  if (!hasPolicy) {
    if (c.directives && typeof c.directives === "object") headers[CSP_HEADER] = policyFromDirectives(/** @type {Record<string, unknown>} */ (c.directives));
    else if (typeof c.policy === "string") headers[CSP_HEADER] = c.policy;
  }
  const key = Object.keys(headers).find((name) => name.toLowerCase() === CSP_HEADER.toLowerCase());
  if (!key) throw new Error("csp.json carries no Content-Security-Policy");
  const policy = headers[key] ?? "";
  delete headers[key];
  headers[CSP_HEADER] = enforceFrameAncestors(policy);
  return headers;
}

/**
 * @typedef {{ schema: 1, version: string, gitSha: string, entry: string, manifestSha256: string, headers: Record<string, string> }} FramePin
 */

/**
 * The checked-in pin: which build is served, the digest of its manifest.json
 * (the manifest in turn digests every file), and the headers it must be served
 * with, so a policy change shows up in review next to the version bump.
 * @param {unknown} raw
 * @returns {FramePin}
 */
export function parsePin(raw) {
  if (!raw || typeof raw !== "object") throw new Error("pin file is not an object");
  const p = /** @type {Record<string, unknown>} */ (raw);
  if (p.schema !== 1) throw new Error("pin file schema must be 1");
  const version = assertSafeVersion(p.version);
  if (typeof p.gitSha !== "string" || !GIT_SHA_RE.test(p.gitSha)) throw new Error("pin gitSha is not a git SHA");
  const entry = assertSafeBundlePath(p.entry);
  if (typeof p.manifestSha256 !== "string" || !SHA256_RE.test(p.manifestSha256)) throw new Error("pin manifestSha256 is not a hex digest");
  const headers = parseCspManifest({ headers: p.headers });
  return { schema: 1, version, gitSha: p.gitSha, entry, manifestSha256: p.manifestSha256, headers };
}

/**
 * @param {FrameManifest} manifest
 * @param {string} manifestSha256
 * @param {Record<string, string>} headers
 * @returns {FramePin}
 */
export function buildPin(manifest, manifestSha256, headers) {
  return { schema: 1, version: manifest.version, gitSha: manifest.gitSha, entry: manifest.entry, manifestSha256, headers };
}

/**
 * Throws unless the manifest is the pinned build.
 * @param {FramePin} pin
 * @param {FrameManifest} manifest
 * @param {string} manifestSha256
 */
export function assertMatchesPin(pin, manifest, manifestSha256) {
  const problems = [];
  if (manifest.version !== pin.version) problems.push(`version ${manifest.version} != pinned ${pin.version}`);
  if (manifest.gitSha !== pin.gitSha) problems.push(`gitSha ${manifest.gitSha} != pinned ${pin.gitSha}`);
  if (manifest.entry !== pin.entry) problems.push(`entry ${manifest.entry} != pinned ${pin.entry}`);
  if (manifestSha256 !== pin.manifestSha256) problems.push("manifest.json digest differs from the pin");
  if (problems.length) throw new Error(`bundle is not the pinned build (${problems.join("; ")}); re-pin deliberately with --pin`);
}

/** @param {FramePin} pin */
export function frameUrl(pin) {
  return `${FRAME_URL_ROOT}/${pin.version}/${pin.entry}`;
}
