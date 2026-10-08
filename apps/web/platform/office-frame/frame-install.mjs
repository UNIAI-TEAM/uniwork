/* global fetch, Buffer */
// Install side of the Docs web frame bundle (UNI-1013): locate, verify and copy
// a fork build into public/. Used by scripts/office-frame-sync.mjs.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

export async function materialize(source, scratch) {
  if (/^https:\/\//.test(source) || source.endsWith(".tar.gz") || source.endsWith(".tgz")) {
    let archive = resolve(source);
    if (/^https:\/\//.test(source)) {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`GET ${source} -> ${response.status}`);
      archive = join(scratch, "bundle.tar.gz");
      writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    }
    const out = join(scratch, "unpacked");
    mkdirSync(out);
    execFileSync("tar", ["-xzf", archive, "-C", out], { stdio: "inherit" });
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

