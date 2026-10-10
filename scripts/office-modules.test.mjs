import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The genoffice web modules are tabled twice: the server derives a token's
// module and checks its flag and size cap (server/internal/service/
// office_frame_module.go), the page picks the frame and reads the same flag
// (packages/core/office/office-modules.ts). A key mistyped on one side makes
// the page read one flag while the server enforces another, and nothing else
// fails. This contract parses both tables and holds them together, with the
// flag catalogue (server/internal/featureflags/keys.go) and the CSP of every
// pinned module frame (CONTRACT C11).

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/** A byte count written as digits joined by `*` (`10 * 1024 * 1024`). */
function bytes(expr, what) {
  assert.match(expr.trim(), /^\d+(\s*\*\s*\d+)*$/, `${what}: ${expr} is not a product of literals`);
  return expr.split("*").reduce((n, part) => n * Number(part.trim()), 1);
}

function goModules() {
  const goFile = "server/internal/service/office_frame_module.go";
  const src = read(goFile);
  const names = Object.fromEntries([...src.matchAll(/\b(OfficeFrameModule\w+)\s*=\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));
  const consts = Object.fromEntries([...src.matchAll(/^const (\w+) = ([\d\s*]+)$/gm)].map((m) => [m[1], bytes(m[2], m[1])]));
  const formats = Object.fromEntries([...read("server/internal/office/contract.go").matchAll(/\b(Format\w+)\s+Format\s*=\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));
  const rows = [...src.matchAll(/\{(OfficeFrameModule\w+),\s*office\.(Format\w+),\s*"(\w+)",\s*(\w+)\}/g)];
  assert.ok(rows.length > 0, `no officeFrameModules rows found in ${goFile}`);
  const out = {};
  for (const [, name, format, flag, cap] of rows) {
    const module = names[name];
    assert.ok(module, `${goFile}: unknown module constant ${name}`);
    assert.ok(formats[format], `${goFile}: unknown format ${format}`);
    const maxBytes = /^\d+$/.test(cap) ? Number(cap) : consts[cap];
    assert.notEqual(maxBytes, undefined, `${goFile}: cap ${cap} of ${module} is not a literal or a const of literals`);
    out[module] = { format: formats[format], flag, maxBytes };
  }
  return out;
}

function tsModules() {
  const tsFile = "packages/core/office/office-modules.ts";
  const src = read(tsFile);
  const docsFlag = /OFFICE_DOCS_WEB_FLAG = "(\w+)"/.exec(read("packages/core/office/format-flags.ts"))?.[1];
  const consts = Object.fromEntries([...src.matchAll(/^const (\w+) = ([\d\s*]+);$/gm)].map((m) => [m[1], bytes(m[2], m[1])]));
  const start = src.indexOf("OFFICE_MODULE_SPECS");
  const block = src.slice(src.indexOf("{", src.indexOf("=", start)), src.indexOf("\n};", start));
  const keys = [...block.matchAll(/^ {2}(\w+): \{/gm)];
  assert.ok(keys.length > 0, `no OFFICE_MODULE_SPECS rows found in ${tsFile}`);
  const out = {};
  keys.forEach((key, i) => {
    const body = block.slice(key.index, keys[i + 1]?.index ?? block.length);
    const flag = /\bflag: (?:"(\w+)"|(\w+))/.exec(body);
    const format = /\bformat: "(\w+)"/.exec(body)?.[1];
    const cap = /\bmaxBytes: (\w+)/.exec(body)?.[1];
    assert.ok(flag && format, `${tsFile}: row ${key[1]} has no flag or format`);
    const flagKey = flag[1] ?? (flag[2] === "OFFICE_DOCS_WEB_FLAG" ? docsFlag : undefined);
    assert.ok(flagKey, `${tsFile}: row ${key[1]} flag ${flag[2]} does not resolve`);
    const maxBytes = cap === undefined ? 0 : /^\d+$/.test(cap) ? Number(cap) : consts[cap];
    assert.notEqual(maxBytes, undefined, `${tsFile}: cap ${cap} of ${key[1]} is not a literal or a const of literals`);
    out[key[1]] = { format, flag: flagKey, maxBytes };
  });
  return out;
}

test("the Go and TypeScript module tables name the same modules, formats, flags and caps", () => {
  const go = goModules();
  const ts = tsModules();
  assert.deepEqual(Object.keys(ts).sort(), Object.keys(go).sort(), "module sets differ");
  for (const module of Object.keys(go)) {
    assert.deepEqual(ts[module], go[module], `module ${module}: TypeScript ${JSON.stringify(ts[module])} vs Go ${JSON.stringify(go[module])}`);
  }
  const union = /export type OfficeModule = ([^\n]+)/.exec(read("packages/core/office/docs-frame-protocol.ts"))?.[1] ?? "";
  assert.deepEqual([...union.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort(), Object.keys(go).sort(), "the protocol's OfficeModule union differs");
});

test("every module flag is declared in the catalogue, and every office_*_web flag is a module", () => {
  const keys = new Set([...read("server/internal/featureflags/keys.go").matchAll(/Key:\s*"(\w+)"/g)].map((m) => m[1]));
  const flags = new Set(Object.values(goModules()).map((m) => m.flag));
  for (const flag of flags) assert.ok(keys.has(flag), `module flag ${flag} is not declared in keys.go`);
  for (const key of keys) {
    if (/^office_\w+_web$/.test(key)) assert.ok(flags.has(key), `${key} is declared but no module reads it`);
  }
});

test("a pinned module frame's CSP allows eval only where CONTRACT C11 says", () => {
  const dir = "apps/web/platform/office-frame";
  const modules = new Set(Object.keys(goModules()));
  const pins = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".pin.json"));
  assert.ok(pins.includes("docs.pin.json"), "docs.pin.json is missing");
  for (const pin of pins) {
    const module = pin.slice(0, -".pin.json".length);
    assert.ok(modules.has(module), `${pin} names no module`);
    const csp = JSON.parse(read(`${dir}/${pin}`)).headers?.["Content-Security-Policy"] ?? "";
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) ?? "";
    assert.ok(scriptSrc, `${pin}: no script-src`);
    assert.doesNotMatch(scriptSrc, /'unsafe-eval'|'unsafe-inline'/, `${pin}: ${scriptSrc}`);
    if (!["sheets", "pdf"].includes(module)) {
      assert.doesNotMatch(scriptSrc, /'wasm-unsafe-eval'/, `${pin}: only sheets and pdf may run WASM (${scriptSrc})`);
    }
  }
});
