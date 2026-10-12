// Per-fixture outcomes and the files a capture run leaves (contract section 3).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLOR_SCHEME, DEVICE_SCALE_FACTOR, EXIT_BLOCKED, EXIT_FAILED, EXIT_OK, LOCALE, TIMEZONE, VIEWPORT } from "./constants.mjs";

export const ok = (extra = {}) => ({ status: "ok", reason: "", ...extra });
export const blocked = (reason) => ({ status: "blocked", reason });
export const failed = (reason) => ({ status: "failed", reason });

/** Width and height of a PNG from its IHDR chunk, or null when the buffer is not a PNG. */
export function pngSize(png) {
  if (!Buffer.isBuffer(png) || png.length < 24 || png.toString("latin1", 1, 4) !== "PNG") return null;
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

/** 0 every fixture ok, 1 any failed, 77 otherwise (a precondition missing for at least one). */
export function exitCodeFor(fixtures) {
  const statuses = Object.values(fixtures).map((entry) => entry.status);
  if (statuses.includes("failed")) return EXIT_FAILED;
  if (statuses.length === 0 || statuses.includes("blocked")) return EXIT_BLOCKED;
  return EXIT_OK;
}

/** meta.json as the contract fixes it, plus `settings` (what was applied) which the job ignores. */
export function buildMeta({ host, forkSha, pinVersion, fixtures, settings = {}, now = new Date() }) {
  return {
    host,
    forkSha,
    pinVersion,
    viewport: { ...VIEWPORT },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    capturedAt: now.toISOString(),
    fixtures: Object.fromEntries(
      Object.entries(fixtures).map(([id, entry]) => [
        id,
        {
          status: entry.status,
          reason: entry.reason ?? "",
          // what the shot really is: its size, and whether the frame paints mainly into a canvas (its text is not in the DOM)
          ...(entry.size ? { size: entry.size } : {}),
          ...(entry.canvasOnly !== undefined ? { canvasOnly: entry.canvasOnly } : {}),
        },
      ]),
    ),
    settings: { locale: LOCALE, timezone: TIMEZONE, colorScheme: COLOR_SCHEME, reducedMotion: "reduce", ...settings },
  };
}

export function hostDir(outDir, host) {
  return join(outDir, host);
}

export function writeMeta(outDir, meta) {
  const dir = hostDir(outDir, meta.host);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

/** The files of one fixture: the shot, the module's text, and the text around it (web: the host page; desktop: the shell window). */
export const CAPTURE_EXTENSIONS = ["png", "txt", "host.txt", "shell.txt"];

/** Writes a fixture's png and txt, and `<id>.host.txt` / `<id>.shell.txt` when the host gave one. */
export function writeCapture(outDir, host, fixtureId, { png, text, hostText, shellText }) {
  const dir = hostDir(outDir, host);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${fixtureId}.png`), png);
  writeFileSync(join(dir, `${fixtureId}.txt`), text);
  if (hostText !== undefined) writeFileSync(join(dir, `${fixtureId}.host.txt`), hostText);
  if (shellText !== undefined) writeFileSync(join(dir, `${fixtureId}.shell.txt`), shellText);
}

/**
 * A fixture that is not ok must leave no png/txt of an earlier run behind:
 * the job compares whatever files it finds, and a stale shot would pass for a
 * fresh one.
 */
export function clearCapture(outDir, host, fixtureId) {
  const dir = hostDir(outDir, host);
  for (const ext of CAPTURE_EXTENSIONS) {
    const file = join(dir, `${fixtureId}.${ext}`);
    if (existsSync(file)) rmSync(file);
  }
}
