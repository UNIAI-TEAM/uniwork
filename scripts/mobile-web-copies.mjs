// The web code apps/chat-mobile still copies instead of importing (ADR 0011:
// views and the stateful core modules are off-limits to the phone). What is
// pure moved to packages/core and is imported (core-allowlist.json); what had
// to stay a copy names its source in the file's header comment ("Copied from
// …", "Ported from …", "← packages/…"). This script reads those headers and
// keeps apps/chat-mobile/web-copies.json: for every copy, the sha256 of each
// web source it names, as of the last time someone reviewed the copy against
// it. scripts/mobile-web-copies.test.mjs fails when a source changed since
// (or a copy appeared or lost its header), so a web fix never silently skips
// the phone.
//
//   node scripts/mobile-web-copies.mjs          print what changed (exit 1 if anything did)
//   node scripts/mobile-web-copies.mjs --write  record the current hashes, after reviewing each copy
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");
export const APP = "apps/chat-mobile";
export const MANIFEST = `${APP}/web-copies.json`;
const SCAN = ["lib", "data", "components"];
const COPY_MARK = /\b(copied from|ported from|copy of|copies)\b|←\s*(?:packages|apps)\b|\bmirror(?:s|ing)?\b|\bin parity\b/i;

/** The leading comment of a file (line or block comments), as one line of prose. */
export function headerOf(source) {
  const lines = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
      lines.push(line.replace(/^(\/\/+|\/\*+|\*+\/?)\s?/, ""));
      continue;
    }
    if (line === "" && lines.length === 0) continue;
    break;
  }
  return lines.join(" ");
}

/** Repo paths a header names, braces expanded ("chat/{a.ts, b.ts}"), that exist as files. */
export function sourcesIn(header) {
  const found = new Set();
  const text = header.replace(/\s*,\s*/g, ",");
  for (const m of text.matchAll(/((?:packages|apps)\/[\w./-]*?)\{([^}]*)\}(\.[a-z]+)?/g)) {
    for (const part of m[2].split(",")) found.add(`${m[1]}${part.trim()}${m[3] ?? ""}`);
  }
  for (const m of text.matchAll(/(?:packages|apps)\/[\w./-]+\.tsx?/g)) found.add(m[0]);
  return [...found]
    .map((p) => p.replace(/[.,;:)]+$/, ""))
    .filter((p) => /\.tsx?$/.test(p) && !p.startsWith(`${APP}/`) && fs.existsSync(path.join(root, p)) && fs.statSync(path.join(root, p)).isFile())
    .sort();
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Every copy in the app and the web sources its header names. */
export function scanCopies() {
  const copies = {};
  for (const dir of SCAN) {
    for (const file of walk(`${APP}/${dir}`, [])) {
      // A file mirrored from the usf repo is not a copy of this one's web code; only what it says besides that counts.
      const header = headerOf(fs.readFileSync(path.join(root, file), "utf8")).replace(/Ported from usf \S+/g, "");
      if (!COPY_MARK.test(header)) continue;
      const sources = sourcesIn(header);
      if (sources.length > 0) copies[file] = sources;
    }
  }
  return copies;
}

export const hashOf = (file) => createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");

export function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(root, MANIFEST), "utf8"));
}

/** What differs between the copies on disk and the manifest, one line each. */
export function drift(copies = scanCopies(), manifest = readManifest()) {
  const out = [];
  for (const [file, sources] of Object.entries(copies)) {
    const recorded = manifest.copies[file];
    if (!recorded) {
      out.push(`${file}: a copy of ${sources.join(", ")} not in ${MANIFEST}`);
      continue;
    }
    for (const source of sources) {
      if (!(source in recorded)) out.push(`${file}: names ${source}, which ${MANIFEST} does not record`);
      else if (recorded[source] !== hashOf(source)) out.push(`${file}: ${source} changed since the copy was last reviewed`);
    }
    for (const source of Object.keys(recorded)) {
      if (!sources.includes(source)) out.push(`${file}: ${MANIFEST} records ${source}, which the header no longer names`);
    }
  }
  for (const file of Object.keys(manifest.copies)) {
    if (!copies[file]) out.push(`${file}: in ${MANIFEST} but no longer a copy (or gone)`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const copies = scanCopies();
  if (process.argv.includes("--write")) {
    const manifest = {
      $comment: "Written by scripts/mobile-web-copies.mjs --write after reviewing each copy against its web source. Do not edit by hand.",
      copies: Object.fromEntries(Object.entries(copies).sort().map(([file, sources]) => [file, Object.fromEntries(sources.map((s) => [s, hashOf(s)]))])),
    };
    fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${MANIFEST}: ${Object.keys(copies).length} copies`);
  } else {
    const lines = drift(copies);
    for (const line of lines) console.log(line);
    process.exitCode = lines.length > 0 ? 1 : 0;
  }
}
