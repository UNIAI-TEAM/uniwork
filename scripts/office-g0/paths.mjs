// DOC-002 (UNI-666) - workspace and lab path resolution shared by the
// office-g0 scripts.
//
// The user checkout (`genoffice`) and the lab (`.uniwork-dev/office-g0`) sit
// beside the workspace root. From the main checkout that root is two levels
// above these scripts; from a linked worktree it is four, with
// `.uniwork-dev/worktrees/<name>` in between. Resolving it once keeps every
// script pointed at the same lab no matter where it is run from.

import fs from 'node:fs';
import path from 'node:path';

/** The repository root of the checkout this script lives in. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * The workspace root that holds `genoffice` and `.uniwork-dev`. Falls back to
 * the main-checkout layout when neither candidate shows the expected entries,
 * so a missing lab surfaces as an explicit path error instead of a silent miss.
 */
export function resolveWorkspaceRoot(repoRoot = REPO_ROOT) {
  const candidates = [
    path.resolve(repoRoot, '..'),
    path.resolve(repoRoot, '..', '..', '..'),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'genoffice')) || fs.existsSync(path.join(c, '.uniwork-dev'))) || candidates[0];
}

/** The shared lab directory; nothing here is committed except the record it writes. */
export function resolveLabRoot(repoRoot = REPO_ROOT) {
  return path.join(resolveWorkspaceRoot(repoRoot), '.uniwork-dev', 'office-g0');
}

/** The read-only user checkout of the upstream repository, when it exists. */
export function resolveUpstreamSource(repoRoot = REPO_ROOT) {
  const candidates = [
    process.env.GENOFFICE_ROOT,
    path.join(resolveWorkspaceRoot(repoRoot), 'genoffice'),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(path.join(c, '.git'))) || candidates[candidates.length - 1];
}

/** The fixture root inside the repository (small fixtures that ship in Git). */
export function resolveFixtureRoot(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, 'docs', 'office', 'g0', 'fixtures', 'files');
}

