import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check, measure, table } from "./mobile-bundle-budget.mjs";

function fakeExport({ withMap = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-export-"));
  const rel = "_expo/static/js/android/entry-abc.hbc";
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), Buffer.alloc(4096, 7));
  if (withMap) fs.writeFileSync(path.join(dir, `${rel}.map`), JSON.stringify({ version: 3, sources: ["a.js", "b.js", "c.js"], mappings: "" }));
  fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ version: 0, bundler: "metro", fileMetadata: { android: { bundle: rel, assets: [] } } }));
  return dir;
}

test("measures the bytecode, its gzip and the source map's modules from an export", () => {
  const m = measure(fakeExport());
  assert.equal(m.bundleKB, 4);
  assert.ok(m.gzipKB > 0 && m.gzipKB < 1, `a run of one byte compresses: ${m.gzipKB}`);
  assert.equal(m.modules, 3);
  assert.equal(measure(fakeExport({ withMap: false })).modules, null);
});

test("an export without an android bundle is an error, not a pass", () => {
  const dir = fakeExport();
  fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ fileMetadata: { ios: { bundle: "x" } } }));
  assert.throws(() => measure(dir), /names no android bundle/);
});

test("fails each number over its ceiling and only those", () => {
  const { over, rows } = check({ bundleKB: 7000, gzipKB: 2000, modules: 2600 }, { bundleKB: 6843, gzipKB: 2922, modules: 2514 });
  assert.deepEqual(over.map((r) => r.key), ["bundleKB", "modules"]);
  assert.match(table(rows), /\*\*over\*\*/);
  assert.deepEqual(check({ bundleKB: 6843, gzipKB: 2922, modules: null }, { bundleKB: 6843, gzipKB: 2922, modules: 2514 }).over, []);
});

test("the committed budget names all three ceilings", () => {
  const budget = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../apps/chat-mobile/bundle-budget.json"), "utf8")).android;
  for (const key of ["bundleKB", "gzipKB", "modules"]) assert.equal(typeof budget[key], "number", `bundle-budget.json android.${key}`);
});
