// The runtime import graph of the @uniwork/core modules apps/chat-mobile may
// import (ADR 0011). One walker for two readers: the boundary test
// (scripts/mobile-core-allowlist.test.mjs) follows it to find what a phone
// cannot carry, and the native-build scope (scripts/mobile-native-scope.mjs)
// follows it to know which core files end up in the app.
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");
export const CORE = "packages/core";

/** One source for the lint rule and this walk: apps/chat-mobile/core-allowlist.json. */
export const ALLOWLIST = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/core-allowlist.json"), "utf8"));

/** Resolve a module path (no extension) under core to a file, or null. */
export function resolveCore(rel) {
  for (const candidate of [`${rel}.ts`, `${rel}.tsx`, `${rel}/index.ts`]) {
    if (fs.existsSync(path.join(root, CORE, candidate))) return `${CORE}/${candidate}`;
  }
  return null;
}

/**
 * Runtime import specifiers of a file. `import type` / `export type`
 * statements vanish at compile time and are skipped; value imports,
 * side-effect imports and dynamic import() are followed.
 */
export function runtimeSpecifiers(file) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  const out = [];
  const stmt = /\b(?:import|export)\s+(type\s+)?(?:\*\s+as\s+[\w$]+|\*|[\w$]+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\})\s+from\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(stmt)) if (!m[1]) out.push(m[2]);
  for (const m of src.matchAll(/\bimport\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

/** A specifier seen from `from`: a core file, a bare package name, or null for a core path that does not resolve. */
export function target(spec, from) {
  let rel;
  if (spec.startsWith("@uniwork/core")) rel = spec.replace(/^@uniwork\/core\/?/, "") || "index";
  else if (spec.startsWith(".")) rel = path.relative(path.join(root, CORE), path.resolve(root, path.dirname(from), spec));
  else return { bare: spec };
  const file = resolveCore(rel.replace(/\.tsx?$/, ""));
  return file ? { file } : { unresolved: `${CORE}/${rel}` };
}

/** Every core file the allowlisted modules reach at runtime, the entries included. */
export function runtimeClosure(entries = ALLOWLIST) {
  const seen = new Set();
  const queue = entries.map(resolveCore).filter(Boolean);
  for (const file of queue) seen.add(file);
  while (queue.length) {
    const file = queue.shift();
    for (const spec of runtimeSpecifiers(file)) {
      const t = target(spec, file);
      if (t.file && !seen.has(t.file)) {
        seen.add(t.file);
        queue.push(t.file);
      }
    }
  }
  return seen;
}
