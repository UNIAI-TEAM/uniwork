// Tests for scripts/office/check-boundaries.mjs. AC-2: the checker fails on a
// planted browser->Node import and on a planted /ee path, and passes on the
// real tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBoundaries } from "./check-boundaries.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function plant(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-boundaries-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function rules(result) {
  return result.violations.map((v) => v.rule);
}

test("real tree passes: browser isolation, no /ee, licence attribution", () => {
  const result = checkBoundaries(REPO_ROOT);
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test("fails on a planted browser -> node: import", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      'import fs from "node:fs";\nexport const x = fs;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("browser_isolation"));
});

test("fails on a TRANSITIVE browser -> node: import", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      'import { helper } from "./helper";\nexport const x = helper;\n',
    "packages/office-engine/src/browser/helper.ts":
      'import { readFileSync } from "node:fs";\nexport const helper = readFileSync;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes("node:fs"), "expected the transitive node:fs resolution to be reported");
});

test("fails on a browser entry importing the node entry point", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      'import { createNodeEngineTransport } from "../node";\nexport const x = createNodeEngineTransport;\n',
    "packages/office-engine/src/node/index.ts": 'import fs from "node:fs";\nexport const createNodeEngineTransport = fs;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("browser_isolation"));
});

test("fails on unverifiable module access in browser scope", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      'const mod = await import(pickEngine());\nconst req = createRequire(import.meta.url);\nexport const x = mod;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes("computed import()"), "expected the computed import() to be flagged");
  assert.ok(detail.includes("createRequire"), "expected createRequire to be flagged");
});

test("fails on a template import the checker cannot enumerate", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      "const mod = await import(`./engines/${name}`);\nexport const x = mod;\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes("template import()"), "expected the ${} template import() to be flagged");
});

test("a literal template import is extracted and checked normally", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      "const fs = await import(`node:fs`);\nexport const x = fs;\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes("node:fs"), "expected the literal template import of node:fs to be caught");
});

test("fails when exports[\"./browser\"] points at node code", () => {
  const root = plant({
    "packages/office-engine/package.json":
      JSON.stringify({ name: "@uniwork/office-engine", exports: { ".": "./src/index.ts", "./browser": "./src/node/index.ts" } }),
    "packages/office-engine/src/index.ts": "export {};\n",
    "packages/office-engine/src/node/index.ts": 'import fs from "node:fs";\nexport const n = fs;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("exports_map"));
});

test("fails when exports[\".\"] target does not exist", () => {
  const root = plant({
    "packages/office-engine/package.json":
      JSON.stringify({ name: "@uniwork/office-engine", exports: { ".": "./src/missing.ts", "./browser": "./src/browser/index.ts" } }),
    "packages/office-engine/src/browser/index.ts": "export {};\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("exports_map"));
});

test("fails on a planted /ee path", () => {
  const root = plant({
    "packages/office-upstream/LICENSE": "Apache-2.0\n",
    "packages/office-upstream/NOTICE": "GenOffice\n",
    "packages/office-upstream/upstream/ee/premium/index.ts": "export const premium = true;\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("ee_path"));
});

test("fails on a planted import of an /ee path", () => {
  const root = plant({
    "packages/office-engine/src/node/index.ts":
      'import { premium } from "../../office-upstream/upstream/ee/premium";\nexport const x = premium;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("ee_path"));
});

test("fails when office-upstream exists without LICENSE/NOTICE", () => {
  const root = plant({
    "packages/office-upstream/upstream/index.ts": "export {};\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const licence = result.violations.filter((v) => v.rule === "licence");
  assert.equal(licence.length, 2);
});

test("an empty LICENSE is a violation, not a pass", () => {
  const root = plant({
    "packages/office-upstream/LICENSE": "",
    "packages/office-upstream/NOTICE": "GenOffice\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("licence"));
});
