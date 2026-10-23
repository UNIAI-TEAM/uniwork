import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// knip's ignoreDependencies hides a package from the unused/unlisted check, so
// each UniChat mobile exception carries its reason in apps/chat-mobile/CLAUDE.md.
// An entry with no reason there is how two unused @rn-primitives packages
// stayed installed: nothing said why they were kept, so nothing asked.
const root = path.resolve(import.meta.dirname, "..");
const knip = JSON.parse(fs.readFileSync(path.join(root, "knip.json"), "utf8"));
const doc = fs.readFileSync(path.join(root, "apps/chat-mobile/CLAUDE.md"), "utf8");

/** Backticked names in the doc; `@scope/*` covers every package of that scope. */
function documented(dep) {
  const names = [...doc.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);
  return names.some((n) => n === dep || (n.endsWith("/*") && dep.startsWith(n.slice(0, -1))));
}

test("every knip ignoreDependencies entry of UniChat mobile is explained in its CLAUDE.md", () => {
  const ignored = knip.workspaces?.["apps/chat-mobile"]?.ignoreDependencies ?? [];
  assert.ok(ignored.length > 0, "the workspace still has its knip block");
  assert.deepEqual(ignored.filter((dep) => !documented(dep)), [], "name each one in apps/chat-mobile/CLAUDE.md with the reason it is kept");
});
