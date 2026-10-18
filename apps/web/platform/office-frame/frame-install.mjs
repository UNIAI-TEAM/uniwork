/* global fetch, Buffer, AbortSignal, console */
// Install side of the genoffice web frame bundles (UNI-1013 docs, UNI-1014
// modules): locate, verify and copy a fork build into public/. Used by
// scripts/office-frame-sync.mjs.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { URL } from "node:url";
import { assertMatchesPin, assertModule, assertSafeVersion, parseCspDocuments, parseCspManifest, parseManifest, PROTOCOL_SHA256_KEYS, sha256Hex } from "./frame-bundle.mjs";

/**
 * The source for logs: scheme and host only. A source URL is a secret (token in the query, userinfo
 * or path), so nothing else of it may reach a warning or an error; a local path or other
 * non-URL value is replaced by a fixed placeholder.
 */
export function redactSourceUrl(source) {
  try {
    const { protocol, host } = new URL(source);
    return host ? `${protocol}//${host}` : "<source>";
  } catch {
    return "<source>";
  }
}

/** Finds the directory holding manifest.json: the source itself, or its only child. */
export function locateBundleDir(source) {
  if (existsSync(join(source, "manifest.json"))) return source;
  const children = readdirSync(source, { withFileTypes: true }).filter((e) => e.isDirectory());
  const holders = children.map((e) => join(source, e.name)).filter((dir) => existsSync(join(dir, "manifest.json")));
  if (holders.length === 1) return holders[0];
  throw new Error(`no manifest.json in ${source} (${holders.length} candidate version directories)`);
}

/** The module a version directory's manifest names (absent = docs). */
function manifestModule(dir) {
  return parseManifest(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))).module;
}

/**
 * Finds one module's version directory in a source, or null when the source
 * has no build of that module. Accepted layouts: a dist-web root holding
 * `<module>/<version>/` directories (the fork's `build:web:all`); one module's
 * directory holding its version (the docs-only `dist-web/docs` of UNI-1013);
 * or a version directory itself. In the last two the manifest's module decides.
 * A source packed inside one wrapping directory (the web-0.1.0-5932073 release
 * tarball's `dist-web/`) resolves to that directory and searches it the same
 * way; two or more candidates are never guessed between.
 */
export function locateModuleBundle(source, module) {
  assertModule(module);
  let root = source;
  const seen = new Set([realpathSync(root)]);
  for (;;) {
    if (existsSync(join(root, "manifest.json"))) return manifestModule(root) === module ? root : null;
    const own = join(root, module);
    if (existsSync(own) && statSync(own).isDirectory()) return locateBundleDir(own);
    const children = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
    const versions = children.filter((e) => existsSync(join(root, e.name, "manifest.json"))).map((e) => join(root, e.name));
    if (versions.length === 0) {
      if (children.length !== 1) return null;
      const next = join(root, children[0].name);
      if (seen.has(realpathSync(next))) return null;
      seen.add(realpathSync(next));
      root = next;
      continue;
    }
    const matching = versions.filter((dir) => manifestModule(dir) === module);
    if (matching.length > 1) throw new Error(`${root} holds ${matching.length} ${module} versions; point the source at one`);
    return matching[0] ?? null;
  }
}

/** Reads and checks a bundle directory against its own manifest. Returns what the install needs. */
export function loadBundle(dir, { allowDirty = false } = {}) {
  const manifestBytes = readFileSync(join(dir, "manifest.json"));
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.dirty && !allowDirty) {
    throw new Error(`${manifest.version} was built from a dirty fork checkout and cannot be reproduced; build from a clean commit (or pass --allow-dirty for a local run, never commit that pin)`);
  }
  const csp = JSON.parse(readFileSync(join(dir, "csp.json"), "utf8"));
  const headers = parseCspManifest(csp);
  const documents = parseCspDocuments(csp);
  // A policy for a file the build does not hold would be served for nothing; refuse it.
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const doc of documents) {
    if (!listed.has(doc.path.slice(1))) throw new Error(`csp.json gives ${doc.path} its own policy but the manifest does not list it`);
  }
  for (const file of manifest.files) {
    const bytes = readFileSync(join(dir, file.path));
    if (bytes.length !== file.bytes) throw new Error(`${file.path}: ${bytes.length} bytes, manifest says ${file.bytes}`);
    if (sha256Hex(bytes) !== file.sha256) throw new Error(`${file.path}: sha256 differs from the manifest`);
  }
  return { manifest, headers, documents, manifestSha256: sha256Hex(manifestBytes) };
}

/**
 * What an archive source may cost before anything is trusted: the real build is
 * ~13 MiB raw / ~11 MiB gzip in 40 files, so these leave headroom, not freedom.
 */
/** @type {{ maxArchiveBytes: number, maxUnpackedBytes: number, maxEntries: number, timeoutMs: number }} */
export const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxUnpackedBytes: 160 * 1024 * 1024,
  maxEntries: 2000,
  timeoutMs: 120_000,
});

// `tar -tv` of GNU tar and busybox: type+mode, owner/group, size, date, time, name.
const LISTING_LINE = /^([-dlhcbpsC])\S*\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(.+)$/;

/**
 * Lists an archive and refuses it before a byte is extracted: only regular
 * files and directories, no absolute or `..` names, bounded entry count and
 * unpacked size. A listing line it cannot read is a refusal, not a guess.
 */
export function assertSafeArchive(archive, limits = DEFAULT_ARCHIVE_LIMITS) {
  if (statSync(archive).size > limits.maxArchiveBytes) throw new Error(`archive is larger than ${limits.maxArchiveBytes} bytes`);
  const listing = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", timeout: limits.timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  let entries = 0;
  let unpacked = 0;
  for (const line of listing.split("\n")) {
    if (line.trim() === "") continue;
    const match = LISTING_LINE.exec(line);
    if (!match) throw new Error(`archive listing line is not understood: ${JSON.stringify(line.slice(0, 120))}`);
    const [, type, size, name] = match;
    if (type !== "-" && type !== "d") throw new Error(`archive member ${JSON.stringify(name)} is not a regular file or directory (type ${type})`);
    const path = name.replace(/^\.\//, "");
    if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").includes("..")) {
      throw new Error(`archive member ${JSON.stringify(name)} escapes the bundle`);
    }
    entries += 1;
    unpacked += Number(size);
    if (entries > limits.maxEntries) throw new Error(`archive has more than ${limits.maxEntries} entries`);
    if (unpacked > limits.maxUnpackedBytes) throw new Error(`archive unpacks to more than ${limits.maxUnpackedBytes} bytes`);
  }
}

/** Downloads with a deadline and a byte cap (checked on the declared length and on what actually arrives). */
async function download(url, target, limits) {
  const response = await fetch(url, { signal: AbortSignal.timeout(limits.timeoutMs) });
  if (!response.ok) throw new Error(`GET ${redactSourceUrl(url)} -> ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limits.maxArchiveBytes) throw new Error(`archive is larger than ${limits.maxArchiveBytes} bytes`);
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > limits.maxArchiveBytes) throw new Error(`archive is larger than ${limits.maxArchiveBytes} bytes`);
    chunks.push(chunk);
  }
  writeFileSync(target, Buffer.concat(chunks));
}

/**
 * The source as a local directory: an archive (or an https URL to one) is
 * checked and unpacked into scratch; a directory is used as it is. The result
 * is the source root, which `locateModuleBundle` searches per module. With `sha256` the archive
 * must hash to it before it is listed or unpacked.
 */
export async function materialize(source, scratch, limits = DEFAULT_ARCHIVE_LIMITS, sha256 = /** @type {string | undefined} */ (undefined)) {
  if (/^https:\/\//.test(source) || source.endsWith(".tar.gz") || source.endsWith(".tgz")) {
    let archive = resolve(source);
    if (/^https:\/\//.test(source)) {
      archive = join(scratch, "bundle.tar.gz");
      await download(source, archive, limits);
    }
    if (sha256 !== undefined && sha256Hex(readFileSync(archive)) !== sha256) {
      throw new Error(`${redactSourceUrl(source)}: the archive's sha256 differs from the committed source (apps/web/platform/office-frame/source.json)`);
    }
    assertSafeArchive(archive, limits);
    const out = join(scratch, "unpacked");
    mkdirSync(out);
    execFileSync("tar", ["-xzf", archive, "-C", out], { stdio: "inherit", timeout: limits.timeoutMs });
    return out;
  }
  return resolve(source);
}

/** Copies the verified files into public/, replacing any older version directories. */
export function install(dir, bundle, root) {
  const target = join(root, assertSafeVersion(bundle.manifest.version));
  const staging = `${target}.staging`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const name of new Set([...bundle.manifest.files.map((f) => f.path), "manifest.json", "csp.json"])) {
    mkdirSync(dirname(join(staging, name)), { recursive: true });
    cpSync(join(dir, name), join(staging, name));
  }
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  for (const entry of existsSync(root) ? readdirSync(root) : []) {
    if (entry !== bundle.manifest.version) rmSync(join(root, entry), { recursive: true, force: true });
  }
  return target;
}

/**
 * The pin carries the headers the frame is served with, and the policies of
 * the documents that have their own; the bundle's csp.json must still agree.
 */
export function assertHeadersMatchPin(pin, headers, documents = []) {
  if (JSON.stringify(pin.headers) !== JSON.stringify(headers)) {
    throw new Error("csp.json differs from the pinned headers; re-pin deliberately with --pin");
  }
  if (JSON.stringify(pin.documents ?? []) !== JSON.stringify(documents)) {
    throw new Error("csp.json differs from the pinned document policies; re-pin deliberately with --pin");
  }
}

/**
 * A pin that records the frame protocol (X-02) only accepts a build compiled
 * against exactly that protocol: a build without the digests, or with other
 * ones, is refused. A pin without protocolSha256 (before the re-pin) checks
 * nothing here; its manifestSha256 still pins the whole build.
 */
export function assertProtocolMatchesPin(pin, manifest) {
  if (!pin.protocolSha256) return;
  if (!manifest.protocolSha256) throw new Error("the build records no protocolSha256 but the pin does; re-pin deliberately with --pin");
  const differs = PROTOCOL_SHA256_KEYS.filter((key) => manifest.protocolSha256[key] !== pin.protocolSha256[key]);
  if (differs.length) throw new Error(`frame protocol differs from the pin (${differs.join(", ")}); re-pin deliberately with --pin`);
}

/** Re-verifies the installed copy against the pin; returns false when it is not installed. */
export function checkInstalled(pin, root) {
  const dir = join(root, pin.version);
  if (!existsSync(join(dir, "manifest.json"))) return false;
  const bundle = loadBundle(dir, { allowDirty: true });
  assertMatchesPin(pin, bundle.manifest, bundle.manifestSha256);
  assertProtocolMatchesPin(pin, bundle.manifest);
  assertHeadersMatchPin(pin, bundle.headers, bundle.documents);
  return true;
}


/**
 * The version the web app may offer: the pinned one only when it is installed
 * and verified against the pin. Anything else (never synced, partly deleted,
 * tampered) is "" so the document screen says the server is not set up instead
 * of mounting an iframe that 404s.
 */
export function offerableFrameVersion(pin, root) {
  if (!pin) return "";
  try {
    return checkInstalled(pin, root) ? pin.version : "";
  } catch (error) {
    console.warn(`office-frame: ${pin.version} is installed but does not verify (${error.message}); this frame is not offered`);
    return "";
  }
}
