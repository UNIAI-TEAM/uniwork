// The six fixtures of the G7-01 manifest (docs/office/g5g6g7/fixtures/manifest.json),
// the same ids as acceptance-rows.json and fixtures-lib. The capture provider
// reads the manifest, never a copy of the list.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./playwright.mjs";
import { MODULE_OF_FORMAT } from "./constants.mjs";

export const FIXTURE_MANIFEST = resolve(REPO_ROOT, "docs", "office", "g5g6g7", "fixtures", "manifest.json");

export function readFixtures(manifestPath = FIXTURE_MANIFEST, root = REPO_ROOT) {
  if (!existsSync(manifestPath)) throw new Error(`no fixture manifest at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return (manifest.fixtures ?? []).map((fixture) => ({
    id: fixture.id,
    format: fixture.format,
    module: MODULE_OF_FORMAT[fixture.format] ?? null,
    path: fixture.path,
    absPath: resolve(root, fixture.path),
    mime: fixture.mime ?? null,
  }));
}

/** `--fixtures a,b` against the manifest: the chosen fixtures in manifest order, or the unknown ids. */
export function selectFixtures(all, wanted) {
  if (!wanted) return { chosen: all, unknown: [] };
  const ids = new Set(all.map((fixture) => fixture.id));
  const unknown = wanted.filter((id) => !ids.has(id));
  return { chosen: all.filter((fixture) => wanted.includes(fixture.id)), unknown };
}
