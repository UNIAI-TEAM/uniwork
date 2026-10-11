// Where the pinned genoffice web builds come from by default (apps/web/platform/office-frame/source.json):
// the public release asset of the fork (UNIAI-TEAM/uniwork-office is public, anonymous download) and
// the sha256 of that tarball. The URL is not a secret, so it is committed beside the pins; a re-pin
// is one commit that changes the six pins and source.json together.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));

/** The committed source file, next to the pins. */
export const SOURCE_PATH = join(SOURCE_DIR, "source.json");

/**
 * Parses the committed source: an https URL of a .tar.gz of the fork's dist-web root and the sha256
 * of that archive. Anything else is a refusal, so a bad edit fails the build instead of installing
 * something unverified.
 * @param {unknown} raw
 * @returns {{ url: string, sha256: string }}
 */
export function parseSource(raw) {
  if (typeof raw !== "object" || raw === null) throw new Error("source.json is not an object");
  const { schema, url, sha256 } = /** @type {Record<string, unknown>} */ (raw);
  if (schema !== 1) throw new Error(`source.json schema ${String(schema)} is not supported`);
  if (typeof url !== "string" || !/^https:\/\/[^\s]+\.tar\.gz$/.test(url)) throw new Error("source.json url must be an https URL of a .tar.gz");
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error("source.json sha256 must be 64 lowercase hex digits");
  return { url, sha256 };
}

/** @returns {{ url: string, sha256: string } | null} null when the file does not exist. */
export function readSource(path = SOURCE_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
  return parseSource(JSON.parse(text));
}

/**
 * The source to install from: an explicit one (--from / OFFICE_FRAME_SOURCE, a directory, a tarball
 * or an https URL; empty counts as unset) wins and is verified only through the pins; otherwise the
 * committed one, whose tarball is also checked against its sha256 before anything is unpacked.
 * @param {string | undefined} override
 * @returns {{ source: string, sha256?: string, committed: boolean } | null}
 */
export function resolveSource(override, committed = readSource()) {
  if (override) return { source: override, committed: false };
  if (committed) return { source: committed.url, sha256: committed.sha256, committed: true };
  return null;
}
