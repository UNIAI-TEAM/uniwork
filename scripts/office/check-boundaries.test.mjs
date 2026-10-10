// Tests for scripts/office/check-boundaries.mjs. AC-2: the checker fails on a
// planted browser->Node import and on a planted /ee path, and passes on the
// real tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bareNodeGlobals, checkBoundaries } from "./check-boundaries.mjs";

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

test("fails when core office code imports node or electron", () => {
  const root = plant({
    "packages/core/office/index.ts":
      'import { ipcRenderer } from "electron";\nexport const x = ipcRenderer;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("browser_isolation"));
});

test("fails when core office code imports an engine Node sidecar", () => {
  const root = plant({
    "packages/core/office/index.ts":
      'import { recalculate } from "@uniwork/office-engine/xlsx/native";\nexport const x = recalculate;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("browser_isolation"));
});

test("fails when the desktop renderer imports Node/main code", () => {
  const root = plant({
    "apps/office-desktop/renderer/index.ts": 'import fs from "node:fs";\nexport const x = fs;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes("desktop_renderer_isolation"));
});

test("fails when desktop graphs use bare privileged specifiers", () => {
  for (const [rel, source, rule] of [
    ["apps/office-desktop/renderer/index.ts", 'import fs from "fs";\nexport const x = fs;\n', "desktop_renderer_isolation"],
    ["apps/office-desktop/renderer/index.ts", 'import { ipcRenderer } from "electron";\nexport const x = ipcRenderer;\n', "desktop_renderer_isolation"],
    ["apps/office-desktop/preload/index.ts", 'import fs from "fs";\nexport const x = fs;\n', "desktop_preload_isolation"],
    ["apps/office-desktop/renderer/index.ts", 'import { main } from "../main/index";\nexport const x = main;\n', "desktop_renderer_isolation"],
    ["apps/office-desktop/preload/index.ts", 'import { main } from "../main/index";\nexport const x = main;\n', "desktop_preload_isolation"],
  ]) {
    const root = plant({
      [rel]: source,
      ...(source.includes("../main") ? { "apps/office-desktop/main/index.ts": "export const main = true;\n" } : {}),
    });
    const result = checkBoundaries(root);
    assert.equal(result.ok, false);
    assert.ok(rules(result).includes(rule), `${rel} should report ${rule}`);
  }
});

test("desktop tabs and library accept their UI exports and reject a native export", () => {
  const renderer = "apps/office-desktop/renderer/index.ts";
  const imports = [
    "@uniwork/views/layout/collection-page",
    "@uniwork/ui/components/ui/dropdown-menu",
    "@uniwork/ui/components/ui/popover",
  ].map((specifier) => `import ${JSON.stringify(specifier)};`).join("\n");
  assert.equal(checkBoundaries(plant({ [renderer]: imports })).ok, true);
  const rejected = checkBoundaries(plant({
    [renderer]: `${imports}\nimport "@uniwork/office-engine/node";`,
  }));
  assert.equal(rejected.ok, false);
  assert.ok(rules(rejected).includes("desktop_renderer_isolation"));
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

test("fails on a bare Node global re-added to a browser-scope file", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      'export const x = Buffer.from("x");\nexport const y = process.env.NODE_ENV;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes('references the Node global "Buffer"'), "expected Buffer.from to be flagged");
  assert.ok(detail.includes('references the Node global "process"'), "expected process.env to be flagged");
  assert.ok(rules(result).every((rule) => rule === "browser_isolation"));
});

test("fails on a bare Node global in a transitive browser-scope helper", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts": 'import { x } from "../pdf/helper";\nexport const y = x;\n',
    "packages/office-engine/src/pdf/helper.ts": 'export const x = Buffer.from("x");\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes('references the Node global "Buffer"'), "expected the transitive Buffer to be flagged");
});

test("ignores Node global names in browser-scope comments and strings", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      "// Buffer.from and process.cwd() are documented here, not used.\n" +
      'export const note = "Buffer is a Node global";\nexport const tag = `process`;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, true, result.violations.map((v) => v.detail).join("\n"));
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

test("fails on eval/Function/import.meta.resolve in browser scope", () => {
  for (const [line, needle] of [
    ["const r = eval(code);", "eval()"],
    ["const f = new Function('return x');", "new Function()"],
    ["const url = import.meta.resolve('./x');", "import.meta.resolve"],
  ]) {
    const root = plant({
      "packages/office-engine/src/browser/index.ts": `${line}\nexport const x = 1;\n`,
    });
    const result = checkBoundaries(root);
    assert.equal(result.ok, false, `expected a violation for ${line}`);
    const detail = result.violations.map((v) => v.detail).join("\n");
    assert.ok(detail.includes(needle), `expected ${needle} to be flagged`);
  }
});

test("a literal Worker/importScripts specifier is chased like an import", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      'const w = new Worker("./worker.ts");\nexport const x = w;\n',
    "packages/office-engine/src/browser/worker.ts":
      'importScripts("./native.ts");\n',
    "packages/office-engine/src/browser/native.ts":
      'import fs from "node:fs";\nexport const n = fs;\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes("node:fs"), "expected the worker graph's node:fs import to be caught");
});

test("a computed Worker/importScripts specifier is flagged, not chased", () => {
  const root = plant({
    "packages/office-engine/src/browser/index.ts":
      "const w = new Worker(pickUrl());\nimportScripts(pickUrl());\nexport const x = w;\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes("computed new Worker()"), "expected the computed Worker() to be flagged");
  assert.ok(detail.includes("computed importScripts()"), "expected the computed importScripts() to be flagged");
});

test("fails when exports[\"./browser\"] carries a runtime condition key", () => {
  const root = plant({
    "packages/office-engine/package.json":
      JSON.stringify({ name: "@uniwork/office-engine", exports: {
        ".": "./src/index.ts",
        "./browser": { types: "./src/browser/index.ts", node: "./src/browser/index.ts", default: "./src/browser/index.ts" },
      } }),
    "packages/office-engine/src/index.ts": "export {};\n",
    "packages/office-engine/src/browser/index.ts": "export {};\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes('"node" runtime condition'), "expected the node condition key to be flagged");
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

// --- R14-2: bare-global scan covers the whole browser surface ---------------

test("fails on a bare Node global planted in a widened browser root", () => {
  for (const rel of [
    "apps/web/platform/office/pdf-render.ts",
    "packages/core/office/pdf-render.ts",
    "packages/office-engine/src/markdown/vendor.ts",
    "packages/office-engine/src/html/vendor.ts",
    "packages/office-engine/src/assets/vendor.ts",
  ]) {
    const root = plant({ [rel]: 'export const x = Buffer.from("x");\n' });
    const result = checkBoundaries(root);
    assert.equal(result.ok, false, `expected ${rel} to be scanned for bare globals`);
    const detail = result.violations.map((v) => v.detail).join("\n");
    assert.ok(detail.includes('references the Node global "Buffer"'), `expected ${rel} Buffer to be flagged`);
  }
});

test("the xlsx vendor typeof-Buffer feature-detect stays allowed, per file", () => {
  const root = plant({
    // The exact shape the allowlist exists for: a typeof guard before Buffer use.
    "packages/office-engine/src/xlsx/vendor.ts":
      'const toEngineBytes = (bytes: Uint8Array): Uint8Array =>\n' +
      '  typeof Buffer === "undefined" ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);\n' +
      'export const x = toEngineBytes;\n',
    // A sibling xlsx file with an unguarded Buffer must still be flagged, so the
    // allowlist is per-file, not a blanket exemption for the lane.
    "packages/office-engine/src/xlsx/adapter.ts": 'export const y = Buffer.from("y");\n',
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const flagged = result.violations.filter((v) => v.file.includes("vendor.ts"));
  assert.deepEqual(flagged, [], "xlsx/vendor.ts must stay clean under the allowlist");
  const detail = result.violations.map((v) => v.file + " " + v.detail).join("\n");
  assert.ok(detail.includes("adapter.ts"), "a sibling xlsx file must still be flagged");
});

test("global/module/exports are forbidden bare globals", () => {
  const root = plant({
    "packages/core/office/ambient.ts":
      "globalThis.global.fetch;\nmodule.exports = {};\nexport const x = 1;\n",
  });
  const result = checkBoundaries(root);
  assert.equal(result.ok, false);
  const detail = result.violations.map((v) => v.detail).join("\n");
  assert.ok(detail.includes('references the Node global "module"'), "expected module to be flagged");
});

// --- R14-3: ternary/case/regex edge cases ----------------------------------

test("a ternary or a switch case still trips the global scan", () => {
  for (const [name, hit] of [
    ["cond ? process : fallback", "process"],
    ["case Buffer:", "Buffer"],
  ]) {
    assert.deepEqual(bareNodeGlobals(`const x = ${name};\n`), [hit], `expected ${name} to flag ${hit}`);
  }
});

test("a regex literal is not a comment and does not false-positive", () => {
  assert.deepEqual(bareNodeGlobals("const re = /Buffer\\.from/;\nexport const x = re;\n"), []);
  // Escaped slashes inside a regex must not be read as a line comment that
  // blanks the rest of the line - the real global after it is still caught.
  assert.deepEqual(
    bareNodeGlobals("const re = /a\\/\\/b/;\nexport const y = process;\n"),
    ["process"],
  );
});

test("object keys, member access and local shadows are not bare globals", () => {
  assert.deepEqual(bareNodeGlobals("export const o = { process: 1 };\n"), []);
  assert.deepEqual(bareNodeGlobals("export const v = foo.Buffer;\n"), []);
  // An optional member of a type (the protocol's `module?: OfficeModule`) is a key, not the global.
  assert.deepEqual(bareNodeGlobals("export interface P {\n  module?: string\n}\nexport const f = (x: { module?: string }) => x;\n"), []);
  // Optional chaining on the global is still a reference.
  assert.deepEqual(bareNodeGlobals("export const e = process?.env;\n"), ["process"]);
  assert.deepEqual(bareNodeGlobals("export function f(process) { return process; }\n"), []);
  assert.deepEqual(
    bareNodeGlobals('import { dynamic } from "next/dynamic";\nconst h = dynamic(() => import("./x").then((module) => module.X));\n'),
    [],
  );
});
