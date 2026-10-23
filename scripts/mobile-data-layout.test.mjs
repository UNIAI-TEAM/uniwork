import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// apps/chat-mobile/data/ grew as a flat namespace: 53 modules at its root
// (chat-*, locale-*, push*, …) beside a few feature folders (auth, calls,
// mutations, queries, realtime, storage, stores). Moving them all at once
// would rewrite every import while other work is in flight, so the root is a
// ratchet instead: a new module goes into a feature folder
// (data/<feature>/, with the feature's api, cache, store and hooks), and the
// ceiling drops each time a root module moves into one. Never raise it.
const root = path.resolve(import.meta.dirname, "..");
const DATA = path.join(root, "apps/chat-mobile/data");
const ROOT_MODULE_CEILING = 53;

const rootModules = () =>
  fs
    .readdirSync(DATA, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
    .map((e) => e.name);

test("new data modules go into a feature folder, not data/'s root", () => {
  const modules = rootModules();
  assert.ok(
    modules.length <= ROOT_MODULE_CEILING,
    `apps/chat-mobile/data/ has ${modules.length} root modules (ceiling ${ROOT_MODULE_CEILING}): put a new module in a feature ` +
      "folder (data/<feature>/), never at the root",
  );
});

test("the ceiling follows the root down", () => {
  const count = rootModules().length;
  assert.equal(
    count,
    ROOT_MODULE_CEILING,
    `data/ now has ${count} root modules: lower ROOT_MODULE_CEILING in scripts/mobile-data-layout.test.mjs to ${count}`,
  );
});
