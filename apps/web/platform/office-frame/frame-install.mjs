/* global fetch, Buffer, AbortSignal, console */
// Install side of the Docs web frame bundle (UNI-1013): locate, verify and copy
// a fork build into public/. Used by scripts/office-frame-sync.mjs.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertMatchesPin, assertSafeVersion, parseCspManifest, parseManifest, sha256Hex } from "./frame-bundle.mjs";

/** Finds the directory holding manifest.json: the source itself, or its only child. */
export function locateBundleDir(source) {
  if (existsSync(join(source, "manifest.json"))) return source;
  const children = readdirSync(source, { withFileTypes: true }).filter((e) => e.isDirectory());
  const holders = children.map((e) => join(source, e.name)).filter((dir) => existsSync(join(dir, "manifest.json")));
  if (holders.length === 1) return holders[0];
  throw new Error(`no manifest.json in ${source} (${holders.length} candidate version directories)`);
}

/** Reads and checks a bundle directory against its own manifest. Returns what the install needs. */
export function loadBundle(dir, { allowDirty = false } = {}) {
  const manifestBytes = readFileSync(join(dir, "manifest.json"));
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.dirty && !allowDirty) {
    throw new Error(`${manifest.version} was built from a dirty fork checkout and cannot be reproduced; build from a clean commit (or pass --allow-dirty for a local run, never commit that pin)`);
  }
  const headers = parseCspManifest(JSON.parse(readFileSync(join(dir, "csp.json"), "utf8")));
  for (const file of manifest.files) {
    const bytes = readFileSync(join(dir, file.path));
    if (bytes.length !== file.bytes) throw new Error(`${file.path}: ${bytes.length} bytes, manifest says ${file.bytes}`);
    if (sha256Hex(bytes) !== file.sha256) throw new Error(`${file.path}: sha256 differs from the manifest`);
  }
  return { manifest, headers, manifestSha256: sha256Hex(manifestBytes) };
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
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
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

export async function materialize(source, scratch, limits = DEFAULT_ARCHIVE_LIMITS) {
  if (/^https:\/\//.test(source) || source.endsWith(".tar.gz") || source.endsWith(".tgz")) {
    let archive = resolve(source);
    if (/^https:\/\//.test(source)) {
      archive = join(scratch, "bundle.tar.gz");
      await download(source, archive, limits);
    }
    assertSafeArchive(archive, limits);
    const out = join(scratch, "unpacked");
    mkdirSync(out);
    execFileSync("tar", ["-xzf", archive, "-C", out], { stdio: "inherit", timeout: limits.timeoutMs });
    return locateBundleDir(out);
  }
  return locateBundleDir(resolve(source));
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

/** The pin carries the headers the frame is served with; the bundle's csp.json must still agree. */
export function assertHeadersMatchPin(pin, headers) {
  if (JSON.stringify(pin.headers) !== JSON.stringify(headers)) {
    throw new Error("csp.json differs from the pinned headers; re-pin deliberately with --pin");
  }
}

/** Re-verifies the installed copy against the pin; returns false when it is not installed. */
export function checkInstalled(pin, root) {
  const dir = join(root, pin.version);
  if (!existsSync(join(dir, "manifest.json"))) return false;
  const bundle = loadBundle(dir, { allowDirty: true });
  assertMatchesPin(pin, bundle.manifest, bundle.manifestSha256);
  assertHeadersMatchPin(pin, bundle.headers);
  return true;
}


/**
 * The version the web app may offer: the pinned one only when it is installed
 * and verified against the pin. Anything else (never synced, partly deleted,
 * tampered) is "" so the document screen keeps the G3 editor instead of
 * mounting an iframe that 404s.
 */
export function offerableFrameVersion(pin, root) {
  if (!pin) return "";
  try {
    return checkInstalled(pin, root) ? pin.version : "";
  } catch (error) {
    console.warn(`office-frame: ${pin.version} is installed but does not verify (${error.message}); the Docs frame is not offered`);
    return "";
  }
}
