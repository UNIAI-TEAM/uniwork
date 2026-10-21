import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// EAS Build picks the package manager from the lockfile it finds between the
// app and the workspace root. A stray package-lock.json (an `npm install` run
// by habit in apps/chat-mobile) made the first production build install with
// npm and fail (PR #387); only that build caught it. The repo is pnpm only:
// pnpm-lock.yaml at the root, no other lockfile in the app or above it. The
// walk reads the working tree, not git, so a file an EAS upload from a laptop
// would carry is caught before it is committed.
const root = path.resolve(import.meta.dirname, "..");
const APP = "apps/chat-mobile";
const FOREIGN = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb"]);
// Generated or installed trees, never uploaded as source (the repo-root .easignore).
const SKIP = new Set(["node_modules", ".expo", "android", "ios", "dist", "coverage", ".git"]);

function foreignLockfiles(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) foreignLockfiles(rel, out);
    } else if (FOREIGN.has(entry.name)) out.push(rel);
  }
  return out;
}

test("the app and the paths above it carry pnpm's lockfile only", () => {
  assert.ok(fs.existsSync(path.join(root, "pnpm-lock.yaml")), "the root keeps pnpm-lock.yaml");
  const above = [".", "apps"].flatMap((dir) => [...FOREIGN].map((name) => path.posix.join(dir, name)).filter((file) => fs.existsSync(path.join(root, file))));
  assert.deepEqual([...above, ...foreignLockfiles(APP)], [], "remove these: EAS would install with another package manager");
});
